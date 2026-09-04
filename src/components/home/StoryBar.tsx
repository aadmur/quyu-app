import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { STORIES } from '@/data/home'
import type { Story } from '@/data/home'
import StoryPlayer from './StoryPlayer'

/** Story 圈「钓友动态」：横滑列表，未看双环（橄榄绿→湖水绿），已看灰环 */
export default function StoryBar() {
  const navigate = useNavigate()
  const [activeStory, setActiveStory] = useState<Story | null>(null)
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())

  const openStory = (story: Story) => {
    setActiveStory(story)
    setSeenIds((prev) => new Set(prev).add(story.id))
  }

  return (
    <>
      <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 py-3" aria-label="钓友动态">
        {/* 首枚：我的「发动态」——灰色虚线环 + 右下角 + 角标 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex w-16 shrink-0 flex-col items-center gap-1"
        >
          <button
            type="button"
            onClick={() => navigate('/publish')}
            className="relative rounded-full border-2 border-dashed border-ink-40 p-[3px]"
            aria-label="发动态"
          >
            <img src="/avatar-8.png" alt="我的头像" className="h-14 w-14 rounded-full object-cover" />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-paper bg-olive text-paper-white">
              <Plus size={12} strokeWidth={2.6} />
            </span>
          </button>
          <span className="w-16 truncate text-center text-[11px] leading-4 text-ink-60">发动态</span>
        </motion.div>

        {STORIES.map((story, i) => {
          const seen = story.seen || seenIds.has(story.id)
          return (
            <motion.div
              key={story.id}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut', delay: 0.05 * (i + 1) }}
              className="flex w-16 shrink-0 flex-col items-center gap-1"
            >
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={() => openStory(story)}
                className={`relative rounded-full p-[2.5px] ${seen ? 'story-ring-seen' : 'story-ring-unseen'}`}
                aria-label={`查看 ${story.name} 的动态`}
              >
                <span className="block rounded-full bg-paper-white p-[2px]">
                  <img src={story.avatar} alt={story.name} className="h-14 w-14 rounded-full object-cover" />
                </span>
                {story.live && (
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-clay px-1.5 text-[10px] leading-4 text-white">
                    直播
                  </span>
                )}
              </motion.button>
              <span className="w-16 truncate text-center text-[11px] leading-4 text-ink">
                {story.name}
              </span>
              {story.official && (
                <span className="-mt-1 text-[10px] leading-3 text-lake">鱼讯</span>
              )}
            </motion.div>
          )
        })}
      </div>

      <AnimatePresence>
        {activeStory && <StoryPlayer story={activeStory} onClose={() => setActiveStory(null)} />}
      </AnimatePresence>
    </>
  )
}
