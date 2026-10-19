import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Firebase push is enabled only when google-services.json is present (see docs/SETUP.md).
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

val keystoreProps = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) load(f.inputStream())
}
val mapsKey: String = (project.findProperty("MAPS_API_KEY") as String?) ?: System.getenv("MAPS_API_KEY") ?: ""

android {
    namespace = "my.giliranbox.giliranbox"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    kotlinOptions { jvmTarget = JavaVersion.VERSION_11.toString() }

    defaultConfig {
        applicationId = "my.giliranbox.giliranbox"
        minSdk = 23                      // Android 6+; covers Android 9 low-end devices
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["MAPS_API_KEY"] = mapsKey
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a") }   // no x86 in release: smaller bundle
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
                storeFile = file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = if (keystoreProps.isNotEmpty()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
            isMinifyEnabled = true        // R8 code shrinking
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    bundle {                              // Play delivers per-ABI / density / language splits from the .aab
        abi { enableSplit = true }
        density { enableSplit = true }
        language { enableSplit = false }  // 3 languages are in Dart, nothing to split
    }
}

flutter { source = "../.." }
