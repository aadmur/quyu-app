import { isNativeApp } from './safeArea'

/** 原生相册选图：返回 dataURL 数组（已压缩）；Web 回退 <input type=file>。
 *  统一压缩：最长边 1600px、JPEG 0.82，控制上传体积（hono bodyLimit 50MB）。 */
export async function pickImages(maxCount = 9): Promise<string[]> {
  if (isNativeApp() && hasPlugin('Camera')) {
    try {
      const { Camera } = await import('@capacitor/camera')
      // 硬超时 60s：原生插件异常挂起时兜底回退 web 方案
      const result = await withTimeout(
        Camera.pickImages({
          quality: 82,
          limit: maxCount,
          presentationStyle: 'fullscreen',
        }),
        60000,
      )
      if (!result) return pickImagesWeb(maxCount)
      const out: string[] = []
      for (const photo of result.photos.slice(0, maxCount)) {
        const url = photo.webPath
        if (!url) continue
        // webPath → fetch → blob → dataURL → 压缩
        const resp = await fetch(url)
        const blob = await resp.blob()
        out.push(await compressImage(blob))
      }
      return out
    } catch {
      return [] // 用户取消或未授权
    }
  }
  return pickImagesWeb(maxCount)
}

/** Web 回退：隐藏文件选择器（移动端浏览器可调起相册/相机） */
function pickImagesWeb(maxCount: number): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = maxCount > 1
    input.onchange = async () => {
      const files = Array.from(input.files ?? []).slice(0, maxCount)
      const out: string[] = []
      for (const f of files) out.push(await compressImage(f))
      resolve(out)
    }
    input.oncancel = () => resolve([])
    input.click()
  })
}

/** canvas 压缩：最长边 1600px，JPEG 0.82 */
async function compressImage(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export interface GeoFix {
  latitude: number
  longitude: number
}

export type GeoFailReason = 'timeout' | 'denied' | 'no-plugin' | 'unsupported'

export interface GeoResult {
  fix: GeoFix | null
  reason?: GeoFailReason
}

/** 检查原生插件是否真的可用（旧 APK 可能没打包 Geolocation 原生模块） */
function hasPlugin(name: string): boolean {
  try {
    const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor
    return !!cap?.Plugins?.[name]
  } catch {
    return false
  }
}

/** 给 Promise 加硬超时，超时返回 null 而不是永远挂起 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/** 获取真实 GPS 定位；任何路径最多 12 秒必返回，永不卡死。
 *  失败时 reason 区分原因：denied=权限被拒 / timeout=超时 / no-plugin=APK 缺原生插件 / unsupported=环境不支持 */
export async function getCurrentPosition(): Promise<GeoResult> {
  try {
    if (isNativeApp()) {
      if (!hasPlugin('Geolocation')) return { fix: null, reason: 'no-plugin' }
      const { Geolocation } = await import('@capacitor/geolocation')
      // 权限请求也加超时——它在部分机型上可能不回调
      const perm = await withTimeout(Geolocation.requestPermissions({ permissions: ['location'] }), 6000)
      if (!perm) return { fix: null, reason: 'timeout' }
      if (perm.location === 'denied') return { fix: null, reason: 'denied' }
      const pos = await withTimeout(
        Geolocation.getCurrentPosition({
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        }),
        12000,
      )
      if (!pos) return { fix: null, reason: 'timeout' }
      return { fix: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }
    }
    // Web：http 非安全上下文下 navigator.geolocation 可能不存在/被拒
    if (!('geolocation' in navigator)) return { fix: null, reason: 'unsupported' }
    return await new Promise<GeoResult>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ fix: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } }),
        (err) => resolve({ fix: null, reason: err.code === err.PERMISSION_DENIED ? 'denied' : 'timeout' }),
        { timeout: 10000, maximumAge: 60000 },
      )
    })
  } catch {
    return { fix: null, reason: 'unsupported' }
  }
}

/** 逆地理编码：坐标 → 可读地址（OSM Nominatim，中文，6s 超时）。
 *  成功返回如「湖北省武汉市江夏区·青龙湾附近」；失败返回 null（调用方回退显示坐标）。 */
export async function reverseGeocode(fix: GeoFix): Promise<string | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?lat=${fix.latitude}&lon=${fix.longitude}` +
      `&format=jsonv2&zoom=16&accept-language=zh-CN`
    const resp = await withTimeout(fetch(url, { headers: { Accept: 'application/json' } }), 6000)
    if (!resp || !resp.ok) return null
    const data = (await resp.json()) as {
      display_name?: string
      address?: Record<string, string | undefined>
    }
    const a = data.address ?? {}
    // 拼「省 市 区县 ·  poi/道路」的短地址，比 display_name 全串更适合 UI
    const region = [a.province ?? a.state, a.city ?? a.town ?? a.county, a.district ?? a.suburb ?? a.county]
      .filter((v, i, arr): v is string => !!v && arr.indexOf(v) === i)
      .join('')
    const poi = a.attraction ?? a.leisure ?? a.park ?? a.village ?? a.hamlet ?? a.road ?? a.neighbourhood ?? ''
    const short = poi && !region.includes(poi) ? `${region}·${poi}` : region
    return short || data.display_name?.split(',').slice(0, 3).join(',') || null
  } catch {
    return null
  }
}
