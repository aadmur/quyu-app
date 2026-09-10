import { useState } from 'react'
import { m } from 'framer-motion'

interface GalleryProps {
  images: string[]
  name: string
}

/** 沉浸式相册：高 300px 横滑 scroll-snap + 页码胶囊 + 底部渐变遮罩，首图推入缩放 */
export default function Gallery({ images, name }: GalleryProps) {
  const [index, setIndex] = useState(0)

  return (
    <div className="relative h-[300px] select-none overflow-hidden">
      <div
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto"
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.min(images.length - 1, Math.round(el.scrollLeft / el.clientWidth)))
        }}
      >
        {images.map((src, i) => (
          <m.img
            key={src}
            src={src}
            alt={`${name} 相册 ${i + 1}`}
            initial={i === 0 ? { scale: 1.08 } : false}
            animate={i === 0 ? { scale: 1 } : undefined}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="h-full w-full shrink-0 snap-center bg-paper object-cover"
            draggable={false}
          />
        ))}
      </div>
      {/* 底部 60px 渐变遮罩过渡到内容区 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[60px] bg-gradient-to-b from-transparent to-paper" />
      {/* 页码胶囊 */}
      <span className="absolute bottom-4 right-4 rounded-full bg-ink/40 px-2.5 py-1 font-num text-[12px] leading-4 text-paper-white">
        <m.span
          key={index}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="inline-block"
        >
          {index + 1}
        </m.span>
        /{images.length}
      </span>
    </div>
  )
}
