plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Single configurable GitHub repository slug ("<OWNER>/<REPO>") for in-app GitHub Releases updates.
// Can also be overridden in CI via -PaegisGithubRepo=owner/repo or AEGIS_GITHUB_REPO.
val DEFAULT_GITHUB_REPO = "itripathiharsh/Aegis-Browser"

val aegisGithubRepo = providers.gradleProperty("aegisGithubRepo")
    .orElse(providers.environmentVariable("AEGIS_GITHUB_REPO"))
    .orElse(DEFAULT_GITHUB_REPO)
    .get()

val aegisVersionName = providers.gradleProperty("aegisVersionName")
    .orElse(providers.environmentVariable("AEGIS_VERSION_NAME"))
    .orElse("1.0.0")
    .get()

val aegisVersionCode = providers.gradleProperty("aegisVersionCode")
    .orElse(providers.environmentVariable("AEGIS_VERSION_CODE"))
    .map { it.toIntOrNull() ?: 1 }
    .orElse(1)
    .get()

android {
    namespace = "com.aegis.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.aegis.browser"
        minSdk = 24
        targetSdk = 35
        versionCode = aegisVersionCode
        versionName = aegisVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val escapedRepo = aegisGithubRepo.replace("\"", "\\\"")
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
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
