export interface IReleaseDownloadSettings {
  /**
   * The source repository path. Expected format {owner}/{repo}
   */
  sourceRepoPath: string
  
  /**
   * The source branch. Used when getting latest
   */
  branchName: string

  /**
   * A flag to choose between latest release and remaining releases
   */
  isLatest: boolean
  
  /**
   * A flag to enable whether to filter by branch name
   */
  filterByBranch: boolean

  /**
   * A flag to enable downloading from prerelease
   */
  preRelease: boolean

  /**
   * The release tag prefix
   */
  latestPrefix: string

  /**
   * The release tag
   */
  tag: string

  /**
   * The release id
   */
  id: string

  /**
   * Name of the file to download
   */
  fileName: string

  /**
   * Download ttarball from release
   */
  tarBall: boolean

  /**
   * Download zipball from release
   */
  zipBall: boolean

  /**
   * Target path to download the file
   */
  outFilePath: string

  /**
   * Extract downloaded files to outFilePath
   */
  extractAssets: boolean
}
