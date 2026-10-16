import { defaultContent } from '../../../context/siteDataSeed';
import { SITE_TEXT_FALLBACKS } from './siteTextFallbacks';

/** What the site shows for this key while nothing is saved, when known. */
export const siteDefault = (key: string): string =>
  defaultContent[key] || SITE_TEXT_FALLBACKS[key] || '';
