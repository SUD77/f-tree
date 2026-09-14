package com.vibethroughcode.ftree.ui.nearby

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.nearby.wire.QrLink
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

const val NearbyQrTag = "nearby-qr"
const val NearbyScanTag = "nearby-scan"

/**
 * The receive screen's code, for another device to point its camera at.
 *
 * Always dark modules on white, in both themes: plenty of scanners cannot read an inverted code, and
 * the one thing this square has to do is be read. The quiet zone is the standard four modules.
 */
@Composable
fun QrPanel(link: QrLink) {
    val modules = remember(link) { QrCodes.modules(link.encode()) }
    val description = stringResource(R.string.nearby_qr_description)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.nearby_qr_title),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(
            modifier = Modifier
                .widthIn(max = 260.dp)
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.White)
                .testTag(NearbyQrTag)
                .semantics { contentDescription = description },
        ) {
            Canvas(Modifier.matchParentSize()) {
                val cells = modules.size + QUIET_ZONE * 2
                val cell = size.minDimension / cells
                for (y in modules.indices) {
                    for (x in modules[y].indices) {
                        if (!modules[y][x]) continue
                        drawRect(
                            color = Color.Black,
                            topLeft = Offset((x + QUIET_ZONE) * cell, (y + QUIET_ZONE) * cell),
                            // A hair over one cell, so antialiasing never leaves pale seams between
                            // neighbours that a scanner could read as a light module.
                            size = Size(cell + 0.5f, cell + 0.5f),
                        )
                    }
                }
            }
        }
        Text(
            stringResource(R.string.nearby_qr_changes),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

private const val QUIET_ZONE = 4

/**
 * "Scan the other screen's code", and everything it takes to get there.
 *
 * The camera is asked for only here, on the tap — never when the feature is opened — behind a
 * sentence that says what it is for, with a way out that costs nothing: *Type the code instead*,
 * not *Cancel*. A device with no camera does not show the button at all. When Android has been told
 * never to ask again, the button leads to the system screen where that can be undone, the same way
 * the updater asks for permission to install.
 */
@Composable
fun ScanAction(onScanned: (QrLink) -> Unit) {
    val context = LocalContext.current
    val hasCamera = remember { context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY) }
    if (!hasCamera) return

    var scanning by rememberSaveable { mutableStateOf(false) }
    var explaining by rememberSaveable { mutableStateOf(false) }
    var blocked by rememberSaveable { mutableStateOf(false) }

    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            scanning = true
        } else {
            // Android stops showing its own prompt after the second refusal and simply says no. At
            // that point the only way forward is the app's page in system settings, so say so.
            blocked = context.findActivity()
                ?.let { !ActivityCompat.shouldShowRequestPermissionRationale(it, Manifest.permission.CAMERA) }
                ?: false
        }
    }

    if (scanning) {
        QrScanner(
            onScanned = { link ->
                scanning = false
                onScanned(link)
            },
        )
        TextButton(onClick = { scanning = false }) { Text(stringResource(R.string.nearby_scan_stop)) }
    } else {
        OutlinedButton(
            onClick = {
                val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                    PackageManager.PERMISSION_GRANTED
                if (granted) scanning = true else explaining = true
            },
            modifier = Modifier.testTag(NearbyScanTag),
        ) {
            Icon(Icons.Default.QrCodeScanner, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.size(8.dp))
            Text(stringResource(R.string.nearby_scan))
        }
    }

    if (explaining) {
        AlertDialog(
            onDismissRequest = { explaining = false },
            title = { Text(stringResource(R.string.nearby_camera_title)) },
            text = { Text(stringResource(R.string.nearby_camera_body)) },
            confirmButton = {
                TextButton(onClick = {
                    explaining = false
                    request.launch(Manifest.permission.CAMERA)
                }) { Text(stringResource(R.string.nearby_camera_allow)) }
            },
            dismissButton = {
                TextButton(onClick = { explaining = false }) { Text(stringResource(R.string.nearby_camera_type_instead)) }
            },
        )
    }

    if (blocked) {
        AlertDialog(
            onDismissRequest = { blocked = false },
            title = { Text(stringResource(R.string.nearby_camera_blocked_title)) },
            text = { Text(stringResource(R.string.nearby_camera_blocked_body)) },
            confirmButton = {
                TextButton(onClick = {
                    blocked = false
                    runCatching {
                        context.startActivity(
                            Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:${context.packageName}"),
                            ),
                        )
                    }
                }) { Text(stringResource(R.string.nearby_camera_open_settings)) }
            },
            dismissButton = {
                TextButton(onClick = { blocked = false }) { Text(stringResource(R.string.nearby_camera_type_instead)) }
            },
        )
    }
}

/**
 * The camera, looking for one of this app's codes.
 *
 * Frames are analysed on one background thread, newest only — a scanner that queues frames falls
 * further behind the longer somebody holds it still. Each frame's luminance plane goes to
 * [QrCodes.decode] as it arrived. A code that is not an f-tree code (a menu, a Wi-Fi password) is
 * ignored rather than reported, because the person is still aiming. Nothing is recorded or saved.
 */
@Composable
private fun QrScanner(onScanned: (QrLink) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val latestOnScanned by rememberUpdatedState(onScanned)
    val executor = remember { Executors.newSingleThreadExecutor() }
    val found = remember { AtomicBoolean(false) }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { ProcessCameraProvider.getInstance(context).get().unbindAll() }
            executor.shutdown()
        }
    }

    AndroidView(
        factory = { viewContext ->
            val view = PreviewView(viewContext)
            val future = ProcessCameraProvider.getInstance(viewContext)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                val main = ContextCompat.getMainExecutor(viewContext)
                analysis.setAnalyzer(executor) { image ->
                    image.use {
                        if (found.get()) return@use
                        val plane = image.planes[0]
                        val buffer = plane.buffer
                        val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
                        val link = QrCodes.decode(bytes, image.width, image.height, plane.rowStride)
                            ?.let(QrLink::parse)
                        if (link != null && found.compareAndSet(false, true)) {
                            main.execute { latestOnScanned(link) }
                        }
                    }
                }
                runCatching {
                    provider.unbindAll()
                    provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                }
            }, ContextCompat.getMainExecutor(viewContext))
            view
        },
        modifier = Modifier
            .widthIn(max = 360.dp)
            .fillMaxWidth()
            .aspectRatio(1f)
            .clip(RoundedCornerShape(12.dp)),
    )
    Text(
        stringResource(R.string.nearby_scan_hint),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 4.dp),
    )
}

private fun Context.findActivity(): Activity? {
    var current: Context? = this
    while (current is ContextWrapper) {
        if (current is Activity) return current
        current = current.baseContext
    }
    return null
}
