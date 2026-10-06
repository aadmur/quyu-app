-- 帖子交互优化 v14 · 生产直跑版（幂等，可重复执行）。
-- drizzle 生成的 0013_v14_post_interaction.sql 含 `--> statement-breakpoint` 内部标记，MySQL 不识别，
-- 且 ALTER TABLE ADD COLUMN / CREATE INDEX 在 MySQL 8 没有 IF NOT EXISTS。
-- 用「查 information_schema → 拼 SQL → PREPARE/EXECUTE」的单行语句形式，避免 mysql CLI 按 `;`
-- 切分时把过程体截断（详见 0012 直跑版注释）。
-- 执行：mysql -uquyu -p<密码> quyu < 0013_v14_post_interaction_run.sql
--
-- ⚠️ 与 drizzle 版的一处必要差异：`comments.images` 这里带 `DEFAULT (JSON_ARRAY())`。
--
-- 理由不是"不加默认值会报错"——实测恰恰相反，它**不报错**，因此 CI（空库跑 drizzle 版）永远发现不了。
-- 在本机 MySQL 26.7 上对一张有历史行的表做 `ALTER TABLE ... ADD images json NOT NULL`：
--   sql_mode = STRICT_TRANS_TABLES → 成功，历史行值 = NULL
--   sql_mode = ''（非严格）        → 成功，历史行值 = NULL
-- 也就是说 MySQL 会静默把 NOT NULL 的 JSON 列的历史行填成 NULL，**产出一列违反自身声明的数据**。
-- 后果落在前端：mapComment 拿到 `images: null` 后做 `.map/.length` 直接崩，
-- 而且崩在渲染评论列表时，报错形态与"评论功能挂了"无关，极难归因。
-- 因此这里显式写 `DEFAULT (JSON_ARRAY())`，并在下方再兜一次 UPDATE。
-- CI 与生产的这一点差异是刻意的，不要"顺手统一"掉。

CREATE TABLE IF NOT EXISTS `comment_likes` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comment_likes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comment_like` UNIQUE(`user_id`,`comment_id`)
);
CREATE TABLE IF NOT EXISTS `post_favorites` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`post_id` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `post_favorites_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_post_favorite` UNIQUE(`user_id`,`post_id`)
);

-- ── 评论表扩展列（v14） ──
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND COLUMN_NAME = 'author_avatar'), 'SELECT ''skip: comments.author_avatar 已存在''', 'ALTER TABLE `comments` ADD COLUMN `author_avatar` varchar(255) NOT NULL DEFAULT ''/avatar-1.png'''));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND COLUMN_NAME = 'images'), 'SELECT ''skip: comments.images 已存在''', 'ALTER TABLE `comments` ADD COLUMN `images` json NOT NULL DEFAULT (JSON_ARRAY())'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND COLUMN_NAME = 'like_count'), 'SELECT ''skip: comments.like_count 已存在''', 'ALTER TABLE `comments` ADD COLUMN `like_count` int NOT NULL DEFAULT 0'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND COLUMN_NAME = 'deleted_at'), 'SELECT ''skip: comments.deleted_at 已存在''', 'ALTER TABLE `comments` ADD COLUMN `deleted_at` timestamp NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 索引 ──
-- 热门排序分页用 (post_id, like_count, created_at)，与最新排序的
-- idx_comments_post_created 各走一套游标，互不共用（ADR 决定支持 热门/最新 切换）。
SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND INDEX_NAME = 'idx_comments_post_like'), 'SELECT ''skip: idx_comments_post_like''', 'CREATE INDEX `idx_comments_post_like` ON `comments` (`post_id`,`like_count`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comments' AND INDEX_NAME = 'idx_comments_parent'), 'SELECT ''skip: idx_comments_parent''', 'CREATE INDEX `idx_comments_parent` ON `comments` (`parent_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'comment_likes' AND INDEX_NAME = 'idx_comment_like_comment'), 'SELECT ''skip: idx_comment_like_comment''', 'CREATE INDEX `idx_comment_like_comment` ON `comment_likes` (`comment_id`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'post_favorites' AND INDEX_NAME = 'idx_favorite_user_created'), 'SELECT ''skip: idx_favorite_user_created''', 'CREATE INDEX `idx_favorite_user_created` ON `post_favorites` (`user_id`,`created_at`)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 存量数据回填 ──
-- author_avatar：历史评论无头像列，全部落 DEFAULT '/avatar-1.png' 会看起来"所有人同一头像"。
-- 这里从 users 表回填发帖当时的真实头像，取不到则保留默认值。
UPDATE `comments` c
  JOIN `users` u ON u.id = c.user_id
   SET c.author_avatar = u.avatar
 WHERE c.author_avatar = '/avatar-1.png'
   AND u.avatar IS NOT NULL
   AND u.avatar <> '';

-- images：历史行由 DEFAULT (JSON_ARRAY()) 填充，此处显式确认无 NULL，避免前端 mapComment 崩。
UPDATE `comments` SET `images` = JSON_ARRAY() WHERE `images` IS NULL;
