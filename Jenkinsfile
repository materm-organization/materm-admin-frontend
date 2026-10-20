node(label: 'master') {
    def appName
    def branch
    def version
    def targetEnv
    def appEnv
    def dockerTag
    def commitAuthorName
    def commitMessage
    serverInfoData = null
try{
    // Check Target
    stage('STEP1: Checkout SCM') {
            println "Running Stage: Checkout SCM"
            checkout scm
            appName = scm.getUserRemoteConfigs()[0].getUrl().tokenize('/').last().split("\\.")[0]
            branch = env.BRANCH_NAME
            version = readFile('version').trim()
            targetEnv = ''
            if (targetEnv == '' && branch != '') {
                if (branch.startsWith('test') || branch.startsWith('hotfix/')) {
                    targetEnv = 'dev'
                    dockerTag = "${version}-${targetEnv}"
                    appEnv = 'development'
                }else if (branch == 'develop') {
                    targetEnv = 'uat'
                    dockerTag = "${version}-${targetEnv}"
                } else if (branch == 'main') {
                    targetEnv = 'prd'
                    dockerTag = "${version}"
                    appEnv = 'production'
                }
            }
    }
    if (targetEnv == 'dev' || targetEnv == 'uat' || targetEnv == 'prd') {
            stage('STEP2: Get Git Information') {
                    echo "Running Stage: Get Commit Information"
                    def commitInfo = sh(script: 'git log -n 1 --pretty=format:"%an %ae %s"', returnStdout: true).trim().split(' ', 3)
                    commitAuthorName = commitInfo[0]
                    commitMessage = commitInfo[2]
                }
            stage('STEP3: Create .env File') {
                    def API_KEY = env.API_KEY
                    println "Running Stage: Create .env File"
                    // Define the API endpoint
                    def apiEndpoint = "https://script.google.com/macros/s/${API_KEY}/exec?action=getTargetENV&serviceName=${appName}&envName=${targetEnv.toUpperCase()}"
                    // Make HTTP request
                    def response = httpRequest(
                        url: apiEndpoint,
                        httpMode: 'GET',
                        validResponseCodes: '200',
                        consoleLogResponseBody: true
                    )
                    // Parse the response if it's in JSON format
                    def responseData = readJSON(text: response.content)
                    // Convert Json To .ENV
                    def env = responseData.collect { key, value ->
                        "${key.toUpperCase()}=${value}"
                    }.join('\n')
                    // Create .env content
                    def envContent = """
                        ${env}
                    """.trim()
                    // Write to .env file
                    writeFile(file: '.env', text: envContent)
                    // Optional: print the content of the .env file to console for debugging
                    println readFile('.env')
                }

            stage('STEP4: Dockerize') {
                    println "Running Stage : Dockerize"
                    def DOCKER_HUB_USERNAME = env.DOCKER_HUB_USERNAME
                    def DOCKER_IMAGE = ''
                    DOCKER_IMAGE = "${DOCKER_HUB_USERNAME}/${appName}:${dockerTag}"
                    println "DOCKER_IMAGE: ${DOCKER_IMAGE}"
                    script {
                        def registryUrl = env.DOCKER_REGISTRY_URL
                        def registryCredentials = env.DOCKER_CREDENTIALS_ID
                        def dockerfile = 'Dockerfile'
                        def dockerImage
                        docker.withRegistry(registryUrl, registryCredentials) {
                            dockerImage = docker.build("${DOCKER_IMAGE}", "--build-arg APP_ENV=${appEnv} -f ${dockerfile} .")
                            dockerImage.push()
                            // def buildDockerImage = "${DOCKER_HUB_USERNAME}/${appName}:${version}"
                            // sh "docker tag ${DOCKER_IMAGE} ${buildDockerImage}"
                            // dockerImage = docker.build("${buildDockerImage}")
                            // dockerImage.push()
                        }
                    }
                }
        }
    
    if (targetEnv == 'dev' || targetEnv == 'uat') {
        stage('STEP4: Pipeline Deploy') {
            build job: 'DEVOPS-PIPELINE/ithq-app-deployer',
            parameters: [
                string(name: 'APP_NAME', value: "${appName}"),
                string(name: 'ENV_NAME', value: "${targetEnv}"),
                string(name: 'VERSION', value: "${dockerTag}"),
                string(name: 'DETAIL', value: "\n\nService Name: \n${appName} \n\nVersion: \n${dockerTag} \n\nDeployer: \n${commitAuthorName} \n\nMessage: \n${commitMessage} to ${branch}\n\n")
            ]
        }
    }
    if (targetEnv == 'prd'){
        stage('STEP4: Alert Buil Main') {
            build job: 'DEVOPS-PIPELINE/ithq-telegram-jenkins',
            parameters: [
                string(name: 'NAME', value: "\n\nBuild Success!\nPlease go to Jenkins and initiate the deployment pipeline (ithq-production-deployer)\n\nService Name: \n${appName} \n\nVersion: \n${dockerTag} \n\nMerged By: \n${commitAuthorName} \n\nMessage: \nBuild images  to ${branch}\n\n"),
                string(name: 'STATUS', value: "SUCCESS"),
            ]

        }
    }

    } catch (err){
        stage('FAILURE: Pipeline Alert') {
            build job: 'DEVOPS-PIPELINE/ithq-telegram-jenkins',
            parameters: [
                string(name: 'NAME', value: "\n\nJob:\nContinuous Integration (CI)\n\nService Name: \n${appName} \n\nVersion: \n${dockerTag} \n\nDeployer: \n${commitAuthorName} \n\nError: \n${err}\n\n"),
                string(name: 'STATUS', value: "FAILURE"),
            ]
        }
        currentBuild.result = 'FAILURE'
    }
}