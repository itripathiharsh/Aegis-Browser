import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Single configurable GitHub repository slug ("<OWNER>/<REPO>") for in-app GitHub Releases updates.
// Can also be overridden in CI via -PnivrokGithubRepo=owner/repo or NIVROK_GITHUB_REPO.
val DEFAULT_GITHUB_REPO = "itripathiharsh/Aegis-Browser"

val nivrokGithubRepo = providers.gradleProperty("nivrokGithubRepo")
    .orElse(providers.gradleProperty("aegisGithubRepo"))
    .orElse(providers.environmentVariable("NIVROK_GITHUB_REPO"))
    .orElse(providers.environmentVariable("AEGIS_GITHUB_REPO"))
    .orElse(DEFAULT_GITHUB_REPO)
    .get()

val nivrokVersionName = providers.gradleProperty("nivrokVersionName")
    .orElse(providers.gradleProperty("aegisVersionName"))
    .orElse(providers.environmentVariable("NIVROK_VERSION_NAME"))
    .orElse(providers.environmentVariable("AEGIS_VERSION_NAME"))
    .orElse("1.0.8")
    .get()

val nivrokVersionCode = providers.gradleProperty("nivrokVersionCode")
    .orElse(providers.gradleProperty("aegisVersionCode"))
    .orElse(providers.environmentVariable("NIVROK_VERSION_CODE"))
    .orElse(providers.environmentVariable("AEGIS_VERSION_CODE"))
    .map { it.toIntOrNull() ?: 1000008 }
    .orElse(1000008)
    .get()

android {
    namespace = "com.nivrok.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.itripathiharsh.nivrok"
        minSdk = 24
        targetSdk = 35
        versionCode = nivrokVersionCode
        versionName = nivrokVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val escapedRepo = nivrokGithubRepo.replace("\"", "\\\"")
        buildConfigField("String", "GITHUB_REPO", "\"$escapedRepo\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("aegisConsistent") {
            val ksPath = System.getenv("AEGIS_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }
                ?: "aegis-signing.jks"
            storeFile = file(ksPath)
            storePassword = System.getenv("AEGIS_KEYSTORE_PASSWORD")?.takeIf { it.isNotBlank() }
                ?: "aegis-open-source"
            keyAlias = System.getenv("AEGIS_KEY_ALIAS")?.takeIf { it.isNotBlank() }
                ?: "aegis-release"
            keyPassword = System.getenv("AEGIS_KEY_PASSWORD")?.takeIf { it.isNotBlank() }
                ?: "aegis-open-source"
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        debug {
            versionNameSuffix = "-debug"
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("aegisConsistent")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("aegisConsistent")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
        unitTests.all { test ->
            val envDir = System.getenv("ROBOLECTRIC_DEPS_DIR")?.takeIf { it.isNotBlank() }
            val winDeps = if (System.getProperty("os.name").contains("Windows", ignoreCase = true)) {
                File("F:\\gradle-home\\robolectric-deps").takeIf { it.exists() }?.absolutePath
            } else {
                null
            }
            val depsDir = envDir ?: winDeps
            if (depsDir != null) {
                test.systemProperty("robolectric.dependency.dir", depsDir)
            }
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.13")
    testImplementation("androidx.test:core-ktx:1.6.1")
}
