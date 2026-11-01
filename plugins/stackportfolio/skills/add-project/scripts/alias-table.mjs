/**
 * Bundled alias table for detect-stack.
 * Maps ecosystem dependencies, images, and tools to canonical product names and kinds.
 * Kind must be one of: 'runtime' | 'framework' | 'db' | 'infra'
 */

export const ALIAS_TABLE = [
	// Runtimes & Languages
	{ name: 'TypeScript', kind: 'runtime', match: ['typescript', 'ts-node', 'tsx', '@types/node'] },
	{ name: 'Node.js', kind: 'runtime', match: ['node', 'nodejs'] },
	{ name: 'Python', kind: 'runtime', match: ['python', 'py'] },
	{ name: 'Go', kind: 'runtime', match: ['golang', 'go'] },
	{ name: 'Rust', kind: 'runtime', match: ['rust'] },
	{ name: 'Ruby', kind: 'runtime', match: ['ruby'] },
	{ name: 'PHP', kind: 'runtime', match: ['php'] },
	{ name: 'Java', kind: 'runtime', match: ['java', 'openjdk', 'eclipse-temurin'] },
	{ name: 'Kotlin', kind: 'runtime', match: ['kotlin'] },
	{ name: 'Swift', kind: 'runtime', match: ['swift'] },
	{ name: 'Bun', kind: 'runtime', match: ['bun'] },
	{ name: 'Deno', kind: 'runtime', match: ['deno'] },
	{ name: 'Elixir', kind: 'runtime', match: ['elixir'] },

	// Frontend & Full-stack Frameworks
	{ name: 'SvelteKit', kind: 'framework', match: ['@sveltejs/kit'] },
	{ name: 'Svelte', kind: 'framework', match: ['svelte'] },
	{ name: 'React', kind: 'framework', match: ['react', 'react-dom'] },
	{ name: 'Next.js', kind: 'framework', match: ['next'] },
	{ name: 'Vue', kind: 'framework', match: ['vue'] },
	{ name: 'Nuxt', kind: 'framework', match: ['nuxt', 'nuxt3'] },
	{ name: 'Astro', kind: 'framework', match: ['astro'] },
	{ name: 'Remix', kind: 'framework', match: ['remix', '@remix-run/react', '@remix-run/node'] },
	{ name: 'SolidJS', kind: 'framework', match: ['solid-js'] },
	{ name: 'Angular', kind: 'framework', match: ['@angular/core'] },
	{ name: 'Tailwind CSS', kind: 'framework', match: ['tailwindcss'] },
	{ name: 'Bootstrap', kind: 'framework', match: ['bootstrap'] },
	{ name: 'DaisyUI', kind: 'framework', match: ['daisyui'] },
	{ name: 'Redux', kind: 'framework', match: ['redux', '@reduxjs/toolkit'] },
	{ name: 'Zod', kind: 'framework', match: ['zod'] },
	{ name: 'GraphQL', kind: 'framework', match: ['graphql', '@apollo/client', '@apollo/server'] },
	{ name: 'React Native', kind: 'framework', match: ['react-native'] },
	{ name: 'Flutter', kind: 'framework', match: ['flutter'] },
	{ name: 'jQuery', kind: 'framework', match: ['jquery'] },

	// Backend Frameworks
	{ name: 'Express', kind: 'framework', match: ['express'] },
	{ name: 'Fastify', kind: 'framework', match: ['fastify'] },
	{ name: 'NestJS', kind: 'framework', match: ['@nestjs/core', '@nestjs/common'] },
	{ name: 'Koa', kind: 'framework', match: ['koa'] },
	{ name: 'Hono', kind: 'framework', match: ['hono'] },
	{ name: 'Django', kind: 'framework', match: ['django'] },
	{ name: 'Django Rest Framework', kind: 'framework', match: ['djangorestframework'] },
	{ name: 'Flask', kind: 'framework', match: ['flask'] },
	{ name: 'FastAPI', kind: 'framework', match: ['fastapi'] },
	{ name: 'Rails', kind: 'framework', match: ['rails'] },
	{ name: 'Sinatra', kind: 'framework', match: ['sinatra'] },
	{ name: 'Laravel', kind: 'framework', match: ['laravel/framework'] },
	{ name: 'Symfony', kind: 'framework', match: ['symfony/framework-bundle', 'symfony/symfony'] },
	{ name: 'Gin', kind: 'framework', match: ['github.com/gin-gonic/gin'] },
	{ name: 'Echo', kind: 'framework', match: ['github.com/labstack/echo'] },
	{ name: 'Fiber', kind: 'framework', match: ['github.com/gofiber/fiber'] },
	{ name: 'Actix Web', kind: 'framework', match: ['actix-web'] },
	{ name: 'Axum', kind: 'framework', match: ['axum'] },
	{ name: 'Rocket', kind: 'framework', match: ['rocket'] },
	{ name: 'Spring Boot', kind: 'framework', match: ['spring-boot', 'org.springframework.boot'] },

	// Machine Learning & Data
	{ name: 'PyTorch', kind: 'framework', match: ['torch', 'pytorch'] },
	{ name: 'TensorFlow', kind: 'framework', match: ['tensorflow'] },
	{ name: 'Pandas', kind: 'framework', match: ['pandas'] },
	{ name: 'NumPy', kind: 'framework', match: ['numpy'] },
	{ name: 'scikit-learn', kind: 'framework', match: ['scikit-learn', 'sklearn'] },
	{ name: 'OpenAI API', kind: 'framework', match: ['openai'] },
	{ name: 'LangChain', kind: 'framework', match: ['langchain', '@langchain/core'] },

	// Databases & ORMs & Stores
	{
		name: 'PostgreSQL',
		kind: 'db',
		match: [
			'pg',
			'postgres',
			'postgresql',
			'psycopg2',
			'psycopg2-binary',
			'asyncpg',
			'github.com/lib/pq',
			'github.com/jackc/pgx'
		]
	},
	{
		name: 'MySQL',
		kind: 'db',
		match: [
			'mysql',
			'mysql2',
			'pymysql',
			'mysqlclient',
			'github.com/go-sql-driver/mysql'
		]
	},
	{ name: 'MariaDB', kind: 'db', match: ['mariadb'] },
	{
		name: 'SQLite',
		kind: 'db',
		match: [
			'sqlite',
			'sqlite3',
			'better-sqlite3',
			'rusqlite',
			'github.com/mattn/go-sqlite3'
		]
	},
	{
		name: 'MongoDB',
		kind: 'db',
		match: [
			'mongodb',
			'mongoose',
			'pymongo',
			'go.mongodb.org/mongo-driver'
		]
	},
	{
		name: 'Redis',
		kind: 'db',
		match: [
			'redis',
			'ioredis',
			'redis-py',
			'github.com/redis/go-redis'
		]
	},
	{
		name: 'Elasticsearch',
		kind: 'db',
		match: ['elasticsearch', '@elastic/elasticsearch']
	},
	{ name: 'MeiliSearch', kind: 'db', match: ['meilisearch'] },
	{
		name: 'ClickHouse',
		kind: 'db',
		match: ['clickhouse', '@clickhouse/client', 'clickhouse-driver']
	},
	{ name: 'Supabase', kind: 'db', match: ['supabase', '@supabase/supabase-js'] },
	{ name: 'Neon', kind: 'db', match: ['@neondatabase/serverless'] },
	{ name: 'Prisma', kind: 'db', match: ['prisma', '@prisma/client'] },
	{ name: 'Drizzle ORM', kind: 'db', match: ['drizzle-orm', 'drizzle-kit'] },
	{ name: 'TypeORM', kind: 'db', match: ['typeorm'] },
	{ name: 'Sequelize', kind: 'db', match: ['sequelize'] },
	{ name: 'SQLAlchemy', kind: 'db', match: ['sqlalchemy'] },
	{ name: 'GORM', kind: 'db', match: ['gorm.io/gorm', 'github.com/jinzhu/gorm'] },
	{ name: 'Diesel', kind: 'db', match: ['diesel'] },
	{ name: 'SQLx', kind: 'db', match: ['sqlx'] },

	// Infrastructure & Cloud
	{ name: 'Docker', kind: 'infra', match: ['docker'] },
	{ name: 'Docker Compose', kind: 'infra', match: ['docker-compose'] },
	{ name: 'GitHub Actions', kind: 'infra', match: ['github-actions'] },
	{ name: 'GitLab CI', kind: 'infra', match: ['gitlab-ci'] },
	{ name: 'CircleCI', kind: 'infra', match: ['circleci'] },
	{ name: 'Terraform', kind: 'infra', match: ['terraform'] },
	{ name: 'Ansible', kind: 'infra', match: ['ansible'] },
	{ name: 'Kubernetes', kind: 'infra', match: ['kubernetes', 'k8s'] },
	{ name: 'Nginx', kind: 'infra', match: ['nginx'] },
	{ name: 'Vercel', kind: 'infra', match: ['vercel', '@vercel/node', '@vercel/static'] },
	{ name: 'Netlify', kind: 'infra', match: ['netlify', '@netlify/functions'] },
	{
		name: 'Cloudflare',
		kind: 'infra',
		match: ['cloudflare', '@cloudflare/workers-types', 'wrangler']
	},
	{ name: 'Fly.io', kind: 'infra', match: ['fly.io'] },
	{ name: 'Coolify', kind: 'infra', match: ['coolify'] },
	{
		name: 'AWS',
		kind: 'infra',
		match: ['aws', 'aws-sdk', '@aws-sdk', 'boto3', 'aws-cdk']
	},
	{
		name: 'Google Cloud',
		kind: 'infra',
		match: ['google-cloud', '@google-cloud', 'google-cloud-storage']
	},
	{ name: 'Azure', kind: 'infra', match: ['azure', '@azure'] },

	// Dev tools & testing (flagged as dev noise by default)
	{ name: 'ESLint', kind: 'infra', isDevNoise: true, match: ['eslint'] },
	{ name: 'Prettier', kind: 'infra', isDevNoise: true, match: ['prettier'] },
	{ name: 'Jest', kind: 'framework', isDevNoise: true, match: ['jest'] },
	{ name: 'Vitest', kind: 'framework', isDevNoise: true, match: ['vitest'] },
	{ name: 'Playwright', kind: 'infra', isDevNoise: true, match: ['@playwright/test', 'playwright'] },
	{ name: 'Cypress', kind: 'infra', isDevNoise: true, match: ['cypress'] },
	{ name: 'pytest', kind: 'framework', isDevNoise: true, match: ['pytest'] },
	{ name: 'PHPUnit', kind: 'framework', isDevNoise: true, match: ['phpunit/phpunit', 'phpunit'] },
	{ name: 'RSpec', kind: 'framework', isDevNoise: true, match: ['rspec', 'rspec-rails'] }
];

export const DEV_NOISE_PATTERNS = [
	/^eslint-plugin-/,
	/^@typescript-eslint\//,
	/^prettier-plugin-/,
	/^eslint-config-/,
	/^babel-plugin-/,
	/^@types\//,
	/^jest-/,
	/^ts-jest$/,
	/^@testing-library\//,
	/^stylelint-/,
	/^coverage/,
	/^c8$/,
	/^nyc$/
];

export const DOCKER_IMAGE_MAP = {
	node: { name: 'Node.js', kind: 'runtime' },
	python: { name: 'Python', kind: 'runtime' },
	golang: { name: 'Go', kind: 'runtime' },
	rust: { name: 'Rust', kind: 'runtime' },
	ruby: { name: 'Ruby', kind: 'runtime' },
	php: { name: 'PHP', kind: 'runtime' },
	postgres: { name: 'PostgreSQL', kind: 'db' },
	postgresql: { name: 'PostgreSQL', kind: 'db' },
	mysql: { name: 'MySQL', kind: 'db' },
	mariadb: { name: 'MariaDB', kind: 'db' },
	redis: { name: 'Redis', kind: 'db' },
	mongo: { name: 'MongoDB', kind: 'db' },
	elasticsearch: { name: 'Elasticsearch', kind: 'db' },
	'getmeili/meilisearch': { name: 'MeiliSearch', kind: 'db' },
	meilisearch: { name: 'MeiliSearch', kind: 'db' },
	clickhouse: { name: 'ClickHouse', kind: 'db' },
	'clickhouse/clickhouse-server': { name: 'ClickHouse', kind: 'db' },
	nginx: { name: 'Nginx', kind: 'infra' }
};

export const TF_PROVIDER_MAP = {
	aws: { name: 'AWS', kind: 'infra' },
	google: { name: 'Google Cloud', kind: 'infra' },
	azurerm: { name: 'Azure', kind: 'infra' },
	azure: { name: 'Azure', kind: 'infra' },
	cloudflare: { name: 'Cloudflare', kind: 'infra' }
};

export const GH_ACTION_MAP = [
	{ pattern: /actions\/setup-node/i, name: 'Node.js', kind: 'runtime' },
	{ pattern: /actions\/setup-python/i, name: 'Python', kind: 'runtime' },
	{ pattern: /actions\/setup-go/i, name: 'Go', kind: 'runtime' },
	{ pattern: /(?:actions-rs|dtolnay\/rust-toolchain)/i, name: 'Rust', kind: 'runtime' },
	{ pattern: /actions\/setup-java/i, name: 'Java', kind: 'runtime' }
];

/**
 * Resolves a dependency string to a technology entry.
 * If isDev is true and includeDev is false, drops dev-only noise.
 */
export function matchDependency(depName, isDev = false, options = {}) {
	const includeDev = Boolean(options.includeDev);
	const lower = depName.toLowerCase().trim();

	if (isDev && !includeDev) {
		for (const pattern of DEV_NOISE_PATTERNS) {
			if (pattern.test(lower)) return null;
		}
	}

	for (const entry of ALIAS_TABLE) {
		const isMatched = entry.match.some((m) => {
			const mLower = m.toLowerCase();
			if (mLower === lower) return true;
			// Match scoped prefix like @aws-sdk or package prefix
			if (mLower.startsWith('@') && lower.startsWith(mLower + '/')) return true;
			return false;
		});

		if (isMatched) {
			if (entry.isDevNoise && isDev && !includeDev) {
				return null;
			}
			return { name: entry.name, kind: entry.kind };
		}
	}

	return null;
}
