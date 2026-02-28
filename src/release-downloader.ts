import * as core from '@actions/core'
import * as fs from 'fs'
import * as io from '@actions/io'
import * as path from 'path'
import * as thc from 'typed-rest-client/HttpClient'
import { minimatch } from 'minimatch'

import { DownloadMetaData, GithubRelease } from './gh-api'
import { IHeaders, IHttpClientResponse } from 'typed-rest-client/Interfaces'

import { IReleaseDownloadSettings } from './download-settings'

export class ReleaseDownloader {
  private httpClient: thc.HttpClient

  private apiRoot: string

  constructor(httpClient: thc.HttpClient, githubApiUrl: string) {
    this.httpClient = httpClient
    this.apiRoot = githubApiUrl
  }

  async download(
    downloadSettings: IReleaseDownloadSettings
  ): Promise<string[]> {
    let ghRelease: GithubRelease

    if (downloadSettings.isLatest) {
      ghRelease = await this.getlatestRelease(
        downloadSettings.sourceRepoPath,
		downloadSettings.filterByBranch,
        downloadSettings.branchName,
        downloadSettings.preRelease,
		downloadSettings.latestPrefix
      )
    } else if (downloadSettings.tag !== '') {
      ghRelease = await this.getReleaseByTag(
        downloadSettings.sourceRepoPath,
        downloadSettings.tag
      )
    } else if (downloadSettings.id !== '') {
      ghRelease = await this.getReleaseById(
        downloadSettings.sourceRepoPath,
        downloadSettings.id
      )
    } else {
      throw new Error(
        'Config error: Please input a valid tag or release ID, or specify `latest`'
      )
    }

    const resolvedAssets: DownloadMetaData[] = this.resolveAssets(
      ghRelease,
      downloadSettings
    )

    const result = await this.downloadReleaseAssets(
      resolvedAssets,
      downloadSettings.outFilePath
    )

    // Set the output variables for use by other actions
    core.setOutput('tag_name', ghRelease.tag_name)
    core.setOutput('release_name', ghRelease.name)
    core.setOutput('downloaded_files', result)

    return result
  }

  /**
   * Gets the latest release metadata from github api
   * @param repoPath The source repository path. {owner}/{repo}
   */
  private async getlatestRelease(
    repoPath: string,
	filterByBranch: boolean,
	branch: string,
    preRelease: boolean,
	latestPrefix: string
  ): Promise<GithubRelease> {
	  
	let msg: string
	if (preRelease) {
	  msg = `Fetching latest prerelease in repo ${repoPath}`
	}
	else {
	  msg = `Fetching latest release in repo ${repoPath}`
	}
	if (latestPrefix !== undefined && latestPrefix.trim() !== "") {
	  msg = `${msg} with tag prefix ${latestPrefix}`
	} 
	if (filterByBranch){
	  msg = `${msg} for tag branch ${branch}`
	}
	core.info(msg)
    
    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }
    let response: IHttpClientResponse
    let release: GithubRelease

    if (!preRelease && !filterByBranch && (latestPrefix === undefined || latestPrefix.trim() === "")) {
      response = await this.httpClient.get(
        `${this.apiRoot}/repos/${repoPath}/releases/latest`,
        headers
      )

      if (response.message.statusCode !== 200) {
        const err: Error = new Error(
          `[getlatestRelease] Unexpected response: ${response.message.statusCode}`
        )
        throw err
      }
	  
      const responseBody = await response.readBody()
      release = JSON.parse(responseBody.toString())
      core.info(`Found latest release version: ${release.tag_name}`)
	  
	  return release
    } else {
      const allReleases = await this.fetchAllReleases(repoPath)
      const latestRelease: GithubRelease | undefined = allReleases.find(
        r => r.prerelease === preRelease && (filterByBranch === false || (filterByBranch === true && r.tag_name.includes(`.${branch}.`))) && ((latestPrefix === undefined || latestPrefix.trim() === "") || r.tag_name.startsWith(latestPrefix))
      )

      if (latestRelease) {
        release = latestRelease
		if (preRelease) {
			core.info(`Found latest prerelease version: ${release.tag_name}`)
		} else {
			core.info(`Found latest release version: ${release.tag_name}`)
		}
      } else {
        core.info(`No matching releases found`)
        throw new Error('No releases found!')
      }
	  
      return release
    }
  }
  
  private async fetchAllReleases(repoPath: string): Promise<GithubRelease[]> {
	let allReleases: GithubRelease[] = [];
	let page = 1;
	let hasMorePages = true;
	const perPage = 100; // Max allowed by GitHub API

	while (hasMorePages) {
      const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }
	  try {
	    const response = await this.httpClient.get(
	  	  `${this.apiRoot}/repos/${repoPath}/releases`,
		  headers
		)

		if (response.message.statusCode !== 200) {
		  const err: Error = new Error(
		    `[fetchAllReleases] Unexpected response: ${response.message.statusCode}`
		  )
		  throw err
		}

        const responseBody = await response.readBody()
		const releases: GithubRelease[] = JSON.parse(responseBody.toString())
		allReleases = allReleases.concat(releases);

		  // If the response array is empty, it means we have reached the last page
		if (releases.length < perPage) {
		  hasMorePages = false;
		} else {
		  page++;
		}
	  } catch (error) {
	    core.info(`Error fetching releases page ${page}: ${error}`);
		  // Stop fetching if an error occurs
	    hasMorePages = false;
	  }
	}

	return allReleases;
  }

  /**
   * Gets release data of the specified tag
   * @param repoPath The source repository
   * @param tag The github tag to fetch release from.
   */
  private async getReleaseByTag(
    repoPath: string,
    tag: string
  ): Promise<GithubRelease> {
    core.info(`Fetching release ${tag} from repo ${repoPath}`)

    if (tag === '') {
      throw new Error('Config error: Please input a valid tag')
    }

    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }

    const response = await this.httpClient.get(
      `${this.apiRoot}/repos/${repoPath}/releases/tags/${tag}`,
      headers
    )

    if (response.message.statusCode !== 200) {
      const err: Error = new Error(
        `[getReleaseByTag] Unexpected response: ${response.message.statusCode}`
      )
      throw err
    }

    const responseBody = await response.readBody()
    const release: GithubRelease = JSON.parse(responseBody.toString())
    core.info(`Found release tag: ${release.tag_name}`)

    return release
  }

  /**
   * Gets release data of the specified release ID
   * @param repoPath The source repository
   * @param id The github release ID to fetch.
   */
  private async getReleaseById(
    repoPath: string,
    id: string
  ): Promise<GithubRelease> {
    core.info(`Fetching release id:${id} from repo ${repoPath}`)

    if (id === '') {
      throw new Error('Config error: Please input a valid release ID')
    }

    const headers: IHeaders = { Accept: 'application/vnd.github.v3+json' }

    const response = await this.httpClient.get(
      `${this.apiRoot}/repos/${repoPath}/releases/${id}`,
      headers
    )

    if (response.message.statusCode !== 200) {
      const err: Error = new Error(
        `[getReleaseById] Unexpected response: ${response.message.statusCode}`
      )
      throw err
    }

    const responseBody = await response.readBody()
    const release: GithubRelease = JSON.parse(responseBody.toString())
    core.info(`Found release tag: ${release.tag_name}`)

    return release
  }

  private resolveAssets(
    ghRelease: GithubRelease,
    downloadSettings: IReleaseDownloadSettings
  ): DownloadMetaData[] {
    const downloads: DownloadMetaData[] = []

    if (downloadSettings.fileName.length > 0) {
      if (ghRelease && ghRelease.assets.length > 0) {
        for (const asset of ghRelease.assets) {
          // download only matching file names
          if (!minimatch(asset.name, downloadSettings.fileName)) {
            continue
          }

          const dData: DownloadMetaData = {
            fileName: asset.name,
            url: asset['url'],
            isTarBallOrZipBall: false
          }
          downloads.push(dData)
        }

        if (downloads.length === 0) {
          throw new Error(
            `Asset with name ${downloadSettings.fileName} not found!`
          )
        }
      } else {
        throw new Error(`No assets found in release ${ghRelease.name}`)
      }
    }

    if (downloadSettings.tarBall) {
      const repoName = downloadSettings.sourceRepoPath.split('/')[1]
      downloads.push({
        fileName: `${repoName}-${ghRelease.tag_name}.tar.gz`,
        url: ghRelease.tarball_url,
        isTarBallOrZipBall: true
      })
    }

    if (downloadSettings.zipBall) {
      const repoName = downloadSettings.sourceRepoPath.split('/')[1]
      downloads.push({
        fileName: `${repoName}-${ghRelease.tag_name}.zip`,
        url: ghRelease.zipball_url,
        isTarBallOrZipBall: true
      })
    }

    return downloads
  }

  /**
   * Downloads the specified assets from a given URL
   * @param dData The download metadata
   * @param out Target directory
   */
  private async downloadReleaseAssets(
    dData: DownloadMetaData[],
    out: string
  ): Promise<string[]> {
    const outFileDir = path.resolve(out)

    if (!fs.existsSync(outFileDir)) {
      io.mkdirP(outFileDir)
    }

    const downloads: Promise<string>[] = []

    for (const asset of dData) {
      downloads.push(this.downloadFile(asset, out))
    }

    const result = await Promise.all(downloads)
    return result
  }

  private async downloadFile(
    asset: DownloadMetaData,
    outputPath: string
  ): Promise<string> {
    const headers: IHeaders = {
      Accept: 'application/octet-stream'
    }

    if (asset.isTarBallOrZipBall) {
      headers['Accept'] = '*/*'
    }

    core.info(`Downloading file: ${asset.fileName} to: ${outputPath}`)
    const response = await this.httpClient.get(asset.url, headers)

    if (response.message.statusCode === 200) {
      return this.saveFile(outputPath, asset.fileName, response)
    } else {
      const err: Error = new Error(
        `Unexpected response: ${response.message.statusCode}`
      )
      throw err
    }
  }

  private async saveFile(
    outputPath: string,
    fileName: string,
    httpClientResponse: IHttpClientResponse
  ): Promise<string> {
    const outFilePath: string = path.resolve(outputPath, fileName)
    const fileStream: fs.WriteStream = fs.createWriteStream(outFilePath)

    return new Promise((resolve, reject) => {
      fileStream.on('error', err => reject(err))
      const outStream = httpClientResponse.message.pipe(fileStream)

      outStream.on('close', () => {
        resolve(outFilePath)
      })
    })
  }
}
