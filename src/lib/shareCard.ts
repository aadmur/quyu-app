/**
 * 渔获分享卡片（QY-COMM-009）：canvas 2D 直接绘制，竖版 750×1100。
 * 不用 html2canvas（WebView 兼容坑）；中文用系统字体栈，无需内嵌字体。
 * 封面同源加载不设置 crossOrigin，画布不会被污染；加载失败用纯色渐变兜底。
 */

export interface ShareCardData {
  title: string
  authorName: string
  species: string | null
  weight: string | null
  pondName: string | null
  coverUrl: string | null
  landingUrl: string
  qrDataUrl: string | null
}

export const CARD_W = 750
export const CARD_H = 1100

const FONT = '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei",sans-serif'

// 与 tailwind 令牌对齐的配色
const C = {
  ink: '#2d1e1e',
  ink60: 'rgba(45,30,30,0.6)',
  ink40: 'rgba(45,30,30,0.4)',
  paper: '#f2f0e6',
  white: '#ffffff',
  olive: '#716a4b',
  oliveDeep: '#57523a',
  oliveTint: 'rgba(113,106,75,0.08)',
  lake: '#5e7a6e',
  lakeTint: 'rgba(94,122,110,0.1)',
  line: 'rgba(45,30,30,0.08)',
}

/** 兼容旧 WebView 的圆角矩形路径（不依赖 ctx.roundRect） */
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function loadImage(src: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // 同源图片：不设置 crossOrigin，避免 WebView 下 CORS 失败导致画布被污染/加载失败
    const timer = window.setTimeout(() => {
      img.src = ''
      resolve(null)
    }, timeoutMs)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      resolve(null)
    }
    img.src = src
  })
}

/** object-cover 方式把图片绘制进目标区域（居中裁剪） */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.naturalWidth / img.naturalHeight
  const tr = w / h
  let sw = img.naturalWidth
  let sh = img.naturalHeight
  let sx = 0
  let sy = 0
  if (ir > tr) {
    sw = img.naturalHeight * tr
    sx = (img.naturalWidth - sw) / 2
  } else {
    sh = img.naturalWidth / tr
    sy = (img.naturalHeight - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h)
}

/** 逐字换行绘制，最多 maxLines 行，超出末尾加省略号；返回实际占用行数 */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines: number,
): number {
  let line = ''
  let lines = 0
  const chars = [...text]
  for (let i = 0; i < chars.length; i++) {
    const trial = line + chars[i]
    if (ctx.measureText(trial).width > maxW && line) {
      lines++
      if (lines === maxLines) {
        // 截断：回退到能放下省略号
        let cut = line
        while (cut && ctx.measureText(cut + '…').width > maxW) cut = cut.slice(0, -1)
        ctx.fillText(cut + '…', x, y + (maxLines - 1) * lineH)
        return maxLines
      }
      ctx.fillText(line, x, y + (lines - 1) * lineH)
      line = chars[i]
    } else {
      line = trial
    }
  }
  if (line) {
    ctx.fillText(line, x, y + lines * lineH)
    lines++
  }
  return lines
}

/** 绘制一个 chip（圆角胶囊 + 文字），返回占用的总宽度（含与下一个 chip 的间距） */
function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
): number {
  ctx.font = `500 26px ${FONT}`
  const tw = ctx.measureText(text).width
  const w = tw + 44
  const h = 48
  ctx.fillStyle = bg
  roundRectPath(ctx, x, y, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, y + h / 2 + 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  return w + 16
}

/**
 * 主入口：把分享卡片绘制到 canvas（尺寸固定 750×1100）。
 * 全部资源加载失败都有兜底，不会抛出中断流程。
 */
export async function renderShareCard(canvas: HTMLCanvasElement, data: ShareCardData): Promise<void> {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  // 背景
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // —— 品牌条 ——
  ctx.fillStyle = C.olive
  ctx.font = `700 44px ${FONT}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('趣渔', 40, 96)
  ctx.fillStyle = C.ink60
  ctx.font = `400 24px ${FONT}`
  ctx.fillText('钓鱼人的朋友圈', 40 + ctx.measureText('趣渔').width + 60, 96)
  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(40, 122)
  ctx.lineTo(CARD_W - 40, 122)
  ctx.stroke()

  // —— 封面大图（圆角裁剪；失败用渐变兜底） ——
  const cover = { x: 40, y: 148, w: CARD_W - 80, h: 460 }
  ctx.save()
  roundRectPath(ctx, cover.x, cover.y, cover.w, cover.h, 24)
  ctx.clip()
  const coverImg = data.coverUrl ? await loadImage(data.coverUrl) : null
  if (coverImg) {
    drawCover(ctx, coverImg, cover.x, cover.y, cover.w, cover.h)
  } else {
    const g = ctx.createLinearGradient(cover.x, cover.y, cover.x + cover.w, cover.y + cover.h)
    g.addColorStop(0, C.lake)
    g.addColorStop(1, C.oliveDeep)
    ctx.fillStyle = g
    ctx.fillRect(cover.x, cover.y, cover.w, cover.h)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.font = `700 56px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('趣渔', cover.x + cover.w / 2, cover.y + cover.h / 2)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  }
  ctx.restore()

  // —— 鱼种 / 重量 / 钓场 chips ——
  let chipX = 40
  const chipY = 636
  if (data.species) chipX += drawChip(ctx, data.species, chipX, chipY, C.lakeTint, C.lake)
  if (data.weight) chipX += drawChip(ctx, `${data.weight} 斤`, chipX, chipY, C.lakeTint, C.lake)
  if (data.pondName) drawChip(ctx, data.pondName, chipX, chipY, C.oliveTint, C.olive)

  // —— 正文摘要（≤2 行，服务端已截到 60 字，这里再做展示级截断） ——
  ctx.fillStyle = C.ink
  ctx.font = `400 32px ${FONT}`
  const excerptLines = drawWrapped(ctx, data.title, 40, 748, CARD_W - 80, 48, 2)

  // —— 作者名 ——
  ctx.fillStyle = C.ink60
  ctx.font = `400 26px ${FONT}`
  ctx.fillText(`@${data.authorName}`, 40, 748 + excerptLines * 48 + 24)

  // —— 底部二维码卡 ——
  const box = { x: 40, y: CARD_H - 40 - 176, w: CARD_W - 80, h: 176 }
  ctx.fillStyle = C.white
  roundRectPath(ctx, box.x, box.y, box.w, box.h, 20)
  ctx.fill()

  const qrSize = 136
  const qrX = box.x + 20
  const qrY = box.y + 20
  if (data.qrDataUrl) {
    const qrImg = await loadImage(data.qrDataUrl)
    if (qrImg) {
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)
    } else {
      data.qrDataUrl = null // 绘制失败走同一兜底
    }
  }
  if (!data.qrDataUrl) {
    // 降级占位框：虚线边框 + 提示，功能不阻断
    ctx.strokeStyle = C.ink40
    ctx.lineWidth = 2
    ctx.setLineDash([8, 6])
    roundRectPath(ctx, qrX, qrY, qrSize, qrSize, 12)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.ink40
    ctx.font = `400 20px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('二维码暂不可用', qrX + qrSize / 2, qrY + qrSize / 2 + 7)
    ctx.textAlign = 'left'
  }

  const tx = qrX + qrSize + 28
  ctx.fillStyle = C.ink
  ctx.font = `600 30px ${FONT}`
  ctx.fillText('扫码看这条渔获', tx, box.y + 74)
  ctx.fillStyle = C.ink40
  ctx.font = `400 20px ${FONT}`
  // 链接过长时截断到一行的宽度
  let url = data.landingUrl
  const maxUrlW = box.x + box.w - 20 - tx
  while (url && ctx.measureText(url).width > maxUrlW) url = url.slice(0, -1)
  if (url !== data.landingUrl) url = url.slice(0, -1) + '…'
  ctx.fillText(url, tx, box.y + 116)
}

/** canvas → PNG Blob（toBlob 不可用时回退 dataURL 转换） */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((b) => resolve(b), 'image/png')
      return
    }
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const bin = atob(dataUrl.split(',')[1] ?? '')
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      resolve(new Blob([bytes], { type: 'image/png' }))
    } catch {
      resolve(null)
    }
  })
}
