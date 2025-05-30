/* eslint-disable no-console */

// Thanks Nemo for this API!
import { flags } from '@/entrypoint/utils/targets';
import { EmbedOutput, makeEmbed } from '@/providers/base';
import { NotFoundError } from '@/utils/errors';

import { Caption } from '../captions';

const getRegion = (): string | null => {
  try {
    if (typeof window === 'undefined') return null;
    const regionData = window.localStorage.getItem('__MW::region');
    if (!regionData) return null;
    const parsed = JSON.parse(regionData);
    return parsed?.state?.region ?? null;
  } catch (e) {
    console.warn('Unable to access localStorage or parse auth data:', e);
    return null;
  }
};

const getBaseUrl = (): string => {
  const region = getRegion();
  switch (region) {
    case 'us-east':
      return 'https://fed-api-east.pstream.org';
    case 'us-west':
      return 'https://fed-api-west.pstream.org';
    case 'south-america':
      return 'https://fed-api-south.pstream.org';
    case 'asia':
      return 'https://fed-api-asia.pstream.org';
    case 'europe':
      return 'https://fed-api-europe.pstream.org';
    default:
      return 'https://fed-api-east.pstream.org';
  }
};

const BASE_URL = getBaseUrl();

// Language mapping for subtitles
const languageMap: Record<string, string> = {
  'chinese - hong kong': 'zh',
  'chinese - traditional': 'zh',
  czech: 'cs',
  danish: 'da',
  dutch: 'nl',
  english: 'en',
  'english - sdh': 'en',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hungarian: 'hu',
  italian: 'it',
  korean: 'ko',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  'portuguese - brazilian': 'pt',
  romanian: 'ro',
  'spanish - european': 'es',
  'spanish - latin american': 'es',
  swedish: 'sv',
  turkish: 'tr',
  اَلْعَرَبِيَّةُ: 'ar',
  বাংলা: 'bn',
  filipino: 'tl',
  indonesia: 'id',
  اردو: 'ur',
  English: 'en',
  Arabic: 'ar',
  Bosnian: 'bs',
  Bulgarian: 'bg',
  Croatian: 'hr',
  Czech: 'cs',
  Danish: 'da',
  Dutch: 'nl',
  Estonian: 'et',
  Finnish: 'fi',
  French: 'fr',
  German: 'de',
  Greek: 'el',
  Hebrew: 'he',
  Hungarian: 'hu',
  Indonesian: 'id',
  Italian: 'it',
  Norwegian: 'no',
  Persian: 'fa',
  Polish: 'pl',
  Portuguese: 'pt',
  'Protuguese (BR)': 'pt-br',
  Romanian: 'ro',
  Russian: 'ru',
  Serbian: 'sr',
  Slovenian: 'sl',
  Spanish: 'es',
  Swedish: 'sv',
  Thai: 'th',
  Turkish: 'tr',
};

interface StreamData {
  streams: Record<string, string>;
  subtitles: Record<string, any>;
  error?: string;
  name?: string;
  size?: string;
}

const providers = [
  {
    id: 'fedapi-private',
    rank: 303,
    name: 'FED API (Private)',
    useToken: true,
    useCacheUrl: false,
  },
  {
    id: 'feddb',
    rank: 302,
    name: 'FED DB',
    useToken: false,
    useCacheUrl: true,
  },
];

function embed(provider: {
  id: string;
  rank: number;
  name: string;
  useToken: boolean;
  useCacheUrl: boolean;
  disabled?: boolean;
}) {
  return makeEmbed({
    id: provider.id,
    name: provider.name,
    rank: provider.rank,
    disabled: provider.disabled,
    async scrape(ctx): Promise<EmbedOutput> {
      // Parse the query parameters from the URL
      const query = JSON.parse(ctx.url);

      // Build the API URL based on the provider configuration and media type
      let apiUrl: string;

      if (provider.useCacheUrl) {
        // Cache URL format
        apiUrl =
          query.type === 'movie'
            ? `${BASE_URL}/cache/${query.imdbId}`
            : `${BASE_URL}/cache/${query.imdbId}/${query.season}/${query.episode}`;
      } else {
        // Standard API URL format
        apiUrl =
          query.type === 'movie'
            ? `${BASE_URL}/movie/${query.imdbId}`
            : `${BASE_URL}/tv/${query.imdbId}/${query.season}/${query.episode}`;
      }

      // Prepare request headers
      const headers: Record<string, string> = {};
      if (provider.useToken && query.token) {
        headers['ui-token'] = query.token;
      }

      // Fetch data from the API
      const data = await ctx.fetcher<StreamData>(apiUrl, {
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });

      if (data?.error && data.error.startsWith('No results found in MovieBox search')) {
        throw new NotFoundError('No stream found');
      }
      if (data?.error === 'No cached data found for this episode') {
        throw new NotFoundError('No stream found');
      }
      if (data?.error === 'No cached data found for this ID') {
        throw new NotFoundError('No stream found');
      }
      if (!data) throw new NotFoundError('No response from API');

      ctx.progress(50);

      // Process streams data
      const streams = Object.entries(data.streams).reduce((acc: Record<string, string>, [quality, url]) => {
        let qualityKey: number;
        if (quality === 'ORG') {
          // Only add unknown quality if it's an mp4 (handle URLs with query parameters)
          const urlPath = url.split('?')[0]; // Remove query parameters
          if (urlPath.toLowerCase().endsWith('.mp4')) {
            acc.unknown = url;
          }
          return acc;
        }
        if (quality === '4K') {
          qualityKey = 2160;
        } else {
          qualityKey = parseInt(quality.replace('P', ''), 10);
        }
        if (Number.isNaN(qualityKey) || acc[qualityKey]) return acc;
        acc[qualityKey] = url;
        return acc;
      }, {});

      // Filter qualities based on provider type
      const filteredStreams = Object.entries(streams).reduce((acc: Record<string, string>, [quality, url]) => {
        // Skip unknown for cached provider
        if (provider.useCacheUrl && quality === 'unknown') {
          return acc;
        }

        acc[quality] = url;
        return acc;
      }, {});

      // Process captions data
      const captions: Caption[] = [];
      if (data.subtitles) {
        for (const [langKey, subtitleData] of Object.entries(data.subtitles)) {
          // Extract language name from key
          const languageKeyPart = langKey.split('_')[0];
          const languageName = languageKeyPart.charAt(0).toUpperCase() + languageKeyPart.slice(1);
          const languageCode = languageMap[languageName]?.toLowerCase() ?? 'unknown';

          // Check if the subtitle data is in the new format (has subtitle_link)
          if (subtitleData.subtitle_link) {
            const url = subtitleData.subtitle_link;
            const isVtt = url.toLowerCase().endsWith('.vtt');
            captions.push({
              type: isVtt ? 'vtt' : 'srt',
              id: url,
              url,
              language: languageCode,
              hasCorsRestrictions: false,
            });
          }
        }
      }

      ctx.progress(90);

      return {
        stream: [
          {
            id: 'primary',
            captions,
            qualities: {
              ...(filteredStreams[2160] && {
                '4k': {
                  type: 'mp4',
                  url: filteredStreams[2160],
                },
              }),
              ...(filteredStreams[1080] && {
                1080: {
                  type: 'mp4',
                  url: filteredStreams[1080],
                },
              }),
              ...(filteredStreams[720] && {
                720: {
                  type: 'mp4',
                  url: filteredStreams[720],
                },
              }),
              ...(filteredStreams[480] && {
                480: {
                  type: 'mp4',
                  url: filteredStreams[480],
                },
              }),
              ...(filteredStreams[360] && {
                360: {
                  type: 'mp4',
                  url: filteredStreams[360],
                },
              }),
              ...(filteredStreams.unknown && {
                unknown: {
                  type: 'mp4',
                  url: filteredStreams.unknown,
                },
              }),
            },
            type: 'file',
            flags: [flags.CORS_ALLOWED],
          },
        ],
      };
    },
  });
}

export const [FedAPIPrivateScraper, FedDBScraper] = providers.map(embed);
