package com.vibethroughcode.ftree.book

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.graphics.PathParser
import androidx.core.graphics.withSave
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Draws a [Book]'s pages onto an [android.graphics.Canvas] - the Android twin of `site/book/svg.js`.
 *
 * It makes no layout decision: every position, size and line break arrived decided, and a page that
 * looks wrong here looks wrong on the desktop too. The one liberty it takes is the one the format
 * allows (docs/family-book.md): a line of text its own font engine measures wider than the width
 * the composer gave it is shrunk to fit, never grown. For Latin that never happens; for a
 * Devanagari conjunct it can, by a few per cent.
 *
 * The same painter draws the preview and the PDF, so what the reader sees before sharing is what
 * the file holds. Units are PostScript points; the preview scales the canvas, the PDF page is
 * already in points.
 *
 * @param fonts font file key (`book_display`, ...) to its typeface
 * @param photo a person's portrait at the size the book asked for, or null to leave the ring bare
 */
class BookPainter(
    private val fonts: Map<String, Typeface>,
    private val photo: (String) -> Bitmap?,
) {
    /** How many lines had to be shrunk to fit, for the tests. Latin text should never need it. */
    var shrunkLines = 0
        private set

    fun paint(canvas: Canvas, book: Book, pageIndex: Int) {
        val page = book.pages[pageIndex]
        page.items.forEach { draw(canvas, book, it, 1f) }
    }

    private fun draw(canvas: Canvas, book: Book, item: Item, inherited: Float) {
        when (item) {
            is Item.Rect -> {
                val box = RectF(item.x, item.y, item.x + item.w, item.y + item.h)
                fillPaint(book, item.fill, item.op, inherited, box)?.let { paint ->
                    if (item.r != null) canvas.drawRoundRect(box, item.r, item.r, paint) else canvas.drawRect(box, paint)
                }
                strokePaint(item.stroke, item.sw, item.dash, null, null, item.op, inherited)?.let { paint ->
                    if (item.r != null) canvas.drawRoundRect(box, item.r, item.r, paint) else canvas.drawRect(box, paint)
                }
            }
            is Item.Circle -> {
                val box = RectF(item.cx - item.r, item.cy - item.r, item.cx + item.r, item.cy + item.r)
                fillPaint(book, item.fill, item.op, inherited, box, circle = item)?.let { canvas.drawCircle(item.cx, item.cy, item.r, it) }
                strokePaint(item.stroke, item.sw, item.dash, null, null, item.op, inherited)?.let { canvas.drawCircle(item.cx, item.cy, item.r, it) }
            }
            is Item.Path -> {
                val path = PathParser.createPathFromPathData(item.d) ?: return
                if (item.rule == "evenodd") path.fillType = Path.FillType.EVEN_ODD
                val bounds = RectF().also { path.computeBounds(it, true) }
                fillPaint(book, item.fill, item.op, inherited, bounds)?.let { canvas.drawPath(path, it) }
                strokePaint(item.stroke, item.sw, item.dash, item.cap, item.join, item.op, inherited)?.let { canvas.drawPath(path, it) }
            }
            is Item.Text -> drawText(canvas, book, item, inherited)
            is Item.Image -> drawImage(canvas, item, inherited)
            is Item.Group -> {
                canvas.withSave {
                    item.tf?.let { (a, b, c, d, e) ->
                        val f = item.tf[5]
                        concat(Matrix().apply { setValues(floatArrayOf(a, c, e, b, d, f, 0f, 0f, 1f)) })
                    }
                    // Group opacity applies to the group as one picture, not to each item in turn -
                    // overlapping items inside must not show through each other. That is a layer,
                    // and withSave's restore takes it down with the rest.
                    val op = item.op ?: 1f
                    if (op < 1f) saveLayerAlpha(null, (op * 255).roundToInt())
                    item.items.forEach { draw(this, book, it, inherited) }
                }
            }
        }
    }

    private fun drawText(canvas: Canvas, book: Book, item: Item.Text, inherited: Float) {
        val typeface = fonts[book.fonts[item.font]] ?: return
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            this.typeface = typeface
            textSize = item.size
            textAlign = when (item.align) {
                "middle" -> Paint.Align.CENTER
                "end" -> Paint.Align.RIGHT
                else -> Paint.Align.LEFT
            }
        }
        applyFill(paint, book, item.fill, item.op, inherited, null)
        val width = item.w
        if (width != null && width > 0f) {
            val measured = paint.measureText(item.s)
            if (measured > width * 1.005f) {
                paint.textSize = item.size * (width / measured)
                shrunkLines++
            }
        }
        canvas.drawText(item.s, item.x, item.y, paint)
    }

    private fun drawImage(canvas: Canvas, item: Item.Image, inherited: Float) {
        val bitmap = photo(item.id) ?: return
        val dst = RectF(item.x, item.y, item.x + item.w, item.y + item.h)
        // Cover the box, cropping the middle - SVG's preserveAspectRatio="xMidYMid slice".
        val scale = maxOf(dst.width() / bitmap.width, dst.height() / bitmap.height)
        val sw = dst.width() / scale
        val sh = dst.height() / scale
        val sx = (bitmap.width - sw) / 2f
        val sy = (bitmap.height - sh) / 2f
        val src = Rect(sx.roundToInt(), sy.roundToInt(), (sx + sw).roundToInt(), (sy + sh).roundToInt())
        canvas.withSave {
            if (item.clip == "circle") {
                clipPath(Path().apply { addCircle(dst.centerX(), dst.centerY(), min(dst.width(), dst.height()) / 2f, Path.Direction.CW) })
            } else {
                clipRect(dst)
            }
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { alpha = alphaOf(item.op, inherited) }
            drawBitmap(bitmap, src, dst, paint)
        }
    }

    private fun fillPaint(book: Book, fill: Fill?, op: Float?, inherited: Float, bounds: RectF, circle: Item.Circle? = null): Paint? {
        fill ?: return null
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            applyFill(this, book, fill, op, inherited, circle)
        }
    }

    private fun applyFill(paint: Paint, book: Book, fill: Fill, op: Float?, inherited: Float, circle: Item.Circle?) {
        when (fill) {
            is Fill.Solid -> {
                paint.color = fill.colour.argb
                paint.alpha = alphaOf(op, inherited)
            }
            is Fill.Ref -> {
                val gradient = book.defs[fill.id] ?: return
                paint.shader = shaderFor(gradient, circle)
                paint.alpha = alphaOf(op, inherited)
            }
        }
    }

    private fun shaderFor(g: Gradient, circle: Item.Circle?): Shader {
        val colours = IntArray(g.stops.size) { i ->
            val s = g.stops[i]
            (((s.opacity.coerceIn(0f, 1f) * 255).roundToInt()) shl 24) or (s.colour.argb and 0xFFFFFF)
        }
        val positions = FloatArray(g.stops.size) { g.stops[it].offset }
        return when {
            g.type == "linear" -> LinearGradient(g.x1, g.y1, g.x2, g.y2, colours, positions, Shader.TileMode.CLAMP)
            g.units == "item" && circle != null -> RadialGradient(
                circle.cx + g.cx * circle.r, circle.cy + g.cy * circle.r, (g.r * circle.r).coerceAtLeast(0.01f),
                colours, positions, Shader.TileMode.CLAMP,
            )
            else -> RadialGradient(g.cx, g.cy, g.r.coerceAtLeast(0.01f), colours, positions, Shader.TileMode.CLAMP)
        }
    }

    private fun strokePaint(stroke: Colour?, sw: Float?, dash: List<Float>?, cap: String?, join: String?, op: Float?, inherited: Float): Paint? {
        stroke ?: return null
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = stroke.argb
            alpha = alphaOf(op, inherited)
            strokeWidth = sw ?: 1f
            strokeCap = when (cap) {
                "round" -> Paint.Cap.ROUND
                "square" -> Paint.Cap.SQUARE
                else -> Paint.Cap.BUTT
            }
            strokeJoin = when (join) {
                "round" -> Paint.Join.ROUND
                "bevel" -> Paint.Join.BEVEL
                else -> Paint.Join.MITER
            }
            if (!dash.isNullOrEmpty()) {
                val intervals = if (dash.size % 2 == 0) dash else dash + dash
                pathEffect = DashPathEffect(intervals.toFloatArray(), 0f)
            }
        }
    }

    private fun alphaOf(op: Float?, inherited: Float): Int = ((op ?: 1f) * inherited * 255f).roundToInt().coerceIn(0, 255)
}
