/**
 * lib/export/request.ts
 * Query options of the normalized export routes (plan de mejora P3.3):
 *   ?mode=publication            anonymized, no free text
 *   ?mode=publication&include_text=1   … with the reasons, when their publication was approved
 *   ?include_text=0              research mode without free text
 */

import type { BundleOptions } from './bundle';

export function exportOptionsFrom(params: URLSearchParams): Pick<BundleOptions, 'mode' | 'includeText'> {
  const mode = params.get('mode') === 'publication' ? 'publication' : 'research';
  const flag = params.get('include_text');
  const includeText = mode === 'publication' ? flag === '1' : flag !== '0';
  return { mode, includeText };
}
