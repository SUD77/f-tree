package com.vibethroughcode.ftree.update

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The ordinary channel's fallback for when `releases/latest` answers with a desktop release.
 *
 * This is the shape of the real incident: `desktop-v0.6.0` was promoted out of pre-release status,
 * so GitHub started calling it "latest", and [readRelease] cannot parse its tag. Every test here
 * fetches the primary body first — exactly what the repository does — and only reaches for the list
 * when that comes back [ReleaseLookup.NoUsableRelease].
 */
class LatestFallbackTest {

    private fun desktopLatest(tag: String = "desktop-v0.6.0") = """
        {
          "tag_name": "$tag",
          "draft": false,
          "prerelease": false,
          "published_at": "2026-09-11T00:00:00Z",
          "body": "Desktop release notes",
          "assets": [
            {"name": "f-tree-0.6.0.AppImage", "browser_download_url": "https://example.com/f-tree.AppImage", "size": 90000000},
            {"name": "f-tree-Setup-0.6.0.exe", "browser_download_url": "https://example.com/f-tree.exe", "size": 80000000}
          ]
        }
    """.trimIndent()

    private fun androidRelease(tag: String, prerelease: Boolean = false) = """
        {
          "tag_name": "$tag",
          "draft": false,
          "prerelease": $prerelease,
          "published_at": "2026-09-12T00:00:00Z",
          "body": "notes",
          "assets": [{"name": "f-tree-x.apk", "browser_download_url": "https://example.com/x.apk", "size": 1}]
        }
    """.trimIndent()

    private fun list(vararg releases: String) = releases.joinToString(",", "[", "]")

    private val current = AppVersion.parse("0.8.0")!!

    @Test
    fun `a desktop release marked latest does not hide a newer Android one`() = runTest {
        val lookup = readReleaseWithFallback(desktopLatest(), current) {
            list(desktopLatest("desktop-v0.6.0"), androidRelease("v0.9.0"))
        }
        assertEquals("0.9.0", (lookup as ReleaseLookup.Newer).update.version.toString())
    }

    @Test
    fun `the fallback list with nothing newer is up to date, not an error`() = runTest {
        val lookup = readReleaseWithFallback(desktopLatest(), current) {
            list(desktopLatest("desktop-v0.6.0"), androidRelease("v0.8.0"), androidRelease("v0.7.0"))
        }
        assertEquals(ReleaseLookup.UpToDate, lookup)
    }

    @Test
    fun `a beta in the fallback list is still not offered on the ordinary channel`() = runTest {
        val lookup = readReleaseWithFallback(desktopLatest(), current) {
            list(
                desktopLatest("desktop-v0.6.0"),
                androidRelease("v0.10.0-beta.1", prerelease = true),
                androidRelease("v0.8.0"),
            )
        }
        // Not Newer(0.10.0-beta.1): the ordinary channel's guarantee holds even after the fallback.
        assertEquals(ReleaseLookup.UpToDate, lookup)
    }

    @Test
    fun `an ordinary latest release never triggers the second fetch`() = runTest {
        var fetchedList = false
        val lookup = readReleaseWithFallback(androidRelease("v0.9.0"), current) {
            fetchedList = true
            list(androidRelease("v0.9.0"))
        }
        assertFalse("the list endpoint must not be hit when the primary body is usable", fetchedList)
        assertEquals("0.9.0", (lookup as ReleaseLookup.Newer).update.version.toString())
    }

    @Test
    fun `a genuinely unusable primary body still falls back rather than giving up`() = runTest {
        // Empty assets on the primary body (rather than an unparseable tag) reach NoUsableRelease
        // by the same door the desktop case does, and the fallback should still fire.
        val lookup = readReleaseWithFallback("{}", current) {
            list(androidRelease("v0.9.0"))
        }
        assertEquals("0.9.0", (lookup as ReleaseLookup.Newer).update.version.toString())
    }
}
