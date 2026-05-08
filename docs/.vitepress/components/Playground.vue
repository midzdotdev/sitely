<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

interface FixtureEntry {
	name: string;
	url: string;
	result: Record<string, unknown>;
}

interface PageEntry {
	fixtures: FixtureEntry[];
}

interface SiteEntry {
	name: string;
	domain: string;
	pages: Record<string, PageEntry>;
}

interface PlaygroundData {
	sites: Record<string, SiteEntry>;
}

const data = ref<PlaygroundData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const selectedSite = ref<string>("");
const selectedPage = ref<string>("");
const selectedFixture = ref<number>(0);

onMounted(async () => {
	try {
		const response = await fetch("/playground-data.json");
		if (!response.ok) {
			throw new Error(`Failed to load playground data: ${response.status}`);
		}
		data.value = await response.json();
		const siteKeys = Object.keys(data.value?.sites ?? {});
		if (siteKeys.length > 0) {
			selectedSite.value = siteKeys[0]!;
		}
	} catch (err) {
		error.value = err instanceof Error ? err.message : "Unknown error";
	} finally {
		loading.value = false;
	}
});

const siteOptions = computed(() => {
	if (!data.value) return [];
	return Object.entries(data.value.sites).map(([key, site]) => ({
		value: key,
		label: site.name,
	}));
});

const currentSite = computed(() => {
	if (!data.value || !selectedSite.value) return null;
	return data.value.sites[selectedSite.value] ?? null;
});

const pageOptions = computed(() => {
	if (!currentSite.value) return [];
	return Object.keys(currentSite.value.pages);
});

const currentPage = computed(() => {
	if (!currentSite.value || !selectedPage.value) return null;
	return currentSite.value.pages[selectedPage.value] ?? null;
});

const currentFixture = computed(() => {
	if (!currentPage.value) return null;
	return currentPage.value.fixtures[selectedFixture.value] ?? null;
});

const formattedJson = computed(() => {
	if (!currentFixture.value) return "";
	return JSON.stringify(currentFixture.value.result, null, 2);
});

const curlCommand = computed(() => {
	if (!currentFixture.value || !currentSite.value) return "";
	const url = currentFixture.value.url;
	return `curl "https://api.wapi.dev/v1/extract?url=${encodeURIComponent(url)}" \\
  -H "Authorization: Bearer YOUR_API_KEY"`;
});

// Reset page selection when site changes
watch(selectedSite, () => {
	const pages = pageOptions.value;
	selectedPage.value = pages[0] ?? "";
	selectedFixture.value = 0;
});

// Reset fixture selection when page changes
watch(selectedPage, () => {
	selectedFixture.value = 0;
});
</script>

<template>
	<div class="playground">
		<div v-if="loading" class="playground-loading">
			Loading playground data...
		</div>

		<div v-else-if="error" class="playground-error">
			{{ error }}
		</div>

		<div v-else-if="data" class="playground-content">
			<div class="playground-controls">
				<div class="control-group">
					<label for="site-select">Site</label>
					<select id="site-select" v-model="selectedSite">
						<option
							v-for="option in siteOptions"
							:key="option.value"
							:value="option.value"
						>
							{{ option.label }}
						</option>
					</select>
				</div>

				<div class="control-group">
					<label for="page-select">Page pattern</label>
					<select id="page-select" v-model="selectedPage">
						<option
							v-for="page in pageOptions"
							:key="page"
							:value="page"
						>
							{{ page }}
						</option>
					</select>
				</div>

				<div v-if="currentPage && currentPage.fixtures.length > 1" class="control-group">
					<label for="fixture-select">Fixture</label>
					<select id="fixture-select" v-model="selectedFixture">
						<option
							v-for="(fixture, index) in currentPage.fixtures"
							:key="fixture.name"
							:value="index"
						>
							{{ fixture.name }}
						</option>
					</select>
				</div>
			</div>

			<div v-if="currentFixture" class="playground-result">
				<div class="result-meta">
					<div class="meta-item">
						<span class="meta-label">Example URL</span>
						<code class="meta-value">{{ currentFixture.url }}</code>
					</div>
					<div class="meta-item">
						<span class="meta-label">Fixture</span>
						<code class="meta-value">{{ currentFixture.name }}</code>
					</div>
				</div>

				<div class="result-section">
					<h3>Extraction result</h3>
					<div class="json-container">
						<pre><code>{{ formattedJson }}</code></pre>
					</div>
				</div>

				<div class="result-section">
					<h3>Example API request</h3>
					<div class="json-container">
						<pre><code>{{ curlCommand }}</code></pre>
					</div>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.playground {
	margin-top: 1rem;
}

.playground-loading,
.playground-error {
	padding: 2rem;
	text-align: center;
	border-radius: 8px;
	background: var(--vp-c-bg-soft);
	color: var(--vp-c-text-2);
}

.playground-error {
	color: var(--vp-c-danger-1);
}

.playground-controls {
	display: flex;
	flex-wrap: wrap;
	gap: 1rem;
	margin-bottom: 1.5rem;
}

.control-group {
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
	min-width: 200px;
	flex: 1;
}

.control-group label {
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--vp-c-text-2);
}

.control-group select {
	padding: 0.5rem 0.75rem;
	border: 1px solid var(--vp-c-border);
	border-radius: 6px;
	background: var(--vp-c-bg-soft);
	color: var(--vp-c-text-1);
	font-size: 0.875rem;
	font-family: var(--vp-font-family-mono);
	cursor: pointer;
	transition: border-color 0.2s;
}

.control-group select:hover {
	border-color: var(--vp-c-brand-1);
}

.control-group select:focus {
	outline: none;
	border-color: var(--vp-c-brand-1);
	box-shadow: 0 0 0 2px var(--vp-c-brand-soft);
}

.result-meta {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
	margin-bottom: 1.5rem;
	padding: 1rem;
	border-radius: 8px;
	background: var(--vp-c-bg-soft);
}

.meta-item {
	display: flex;
	align-items: baseline;
	gap: 0.75rem;
}

.meta-label {
	font-size: 0.8125rem;
	font-weight: 600;
	color: var(--vp-c-text-3);
	white-space: nowrap;
	min-width: 90px;
}

.meta-value {
	font-size: 0.8125rem;
	color: var(--vp-c-text-1);
	word-break: break-all;
}

.result-section {
	margin-bottom: 1.5rem;
}

.result-section h3 {
	font-size: 0.9375rem;
	font-weight: 600;
	color: var(--vp-c-text-1);
	margin-bottom: 0.5rem;
}

.json-container {
	border-radius: 8px;
	overflow: auto;
	background: var(--vp-code-block-bg);
	max-height: 500px;
}

.json-container pre {
	margin: 0;
	padding: 1rem;
}

.json-container code {
	font-size: 0.8125rem;
	line-height: 1.6;
	color: var(--vp-code-block-color);
	font-family: var(--vp-font-family-mono);
}
</style>
