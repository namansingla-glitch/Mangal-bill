// Things that are set once for the shop. Shop name, phone numbers and GST % can also be
// set from the rate sheet (rows starting with #), and the sheet wins when it has them.

export const CONFIG = {
  appVersion: '1.0.0',
  shopName: 'Mangal Hardware and Sanitary',
  phones: ['9872545358', '9876299358'],
  gstBp: 1800, // 18%

  // "Publish to web" CSV link of the Google Sheet with the rates. Empty = use the rates
  // that came inside the app. Can also be set in settings.json next to index.html.
  ratesUrl: '',

  // Colour used for each brand's buttons. New brands take the spare colours in order.
  brandColors: { ashirvad: '#1D4ED8', supreme: '#CF440D' },
  spareBrandColors: ['#0F766E', '#7C3AED', '#B91C1C', '#3F6212'],

  // Pictures that exist in img/. An item uses "<type>-<item>" first (brass-elbow), then its
  // own name, then an alias from the list below. No match shows the item's initials.
  pictures: ['elbow', 'tee', 'socket', 'union', 'end-cap', 'ball-valve', 'step-bend', 'elbow-45', 'tanki-nipple', 'mta', 'fta', 'bush', 'c-bend', 'pipe', 'brass-elbow', 'brass-tee', 'brass-mta', 'brass-fta'],
  pictureAliases: { 'over-step-bend': 'step-bend', 'tanki-nipple-plain': 'tanki-nipple', 'tank-nipple': 'tanki-nipple', 'pipe-sdr-11': 'pipe', 'elbow-45-degree': 'elbow-45', endcap: 'end-cap', 'ball-valve-plain': 'ball-valve', 'reducing-bush': 'bush', 'reducer-bush': 'bush' },
};

export function pictureFor(typeId, itemId) {
  const has = (n) => CONFIG.pictures.includes(n);
  const alias = CONFIG.pictureAliases[itemId];
  for (const name of [`${typeId}-${itemId}`, alias && `${typeId}-${alias}`, itemId, alias]) if (name && has(name)) return name;
  if (itemId.startsWith('pipe')) return 'pipe';
  return null;
}

export function brandColor(brandId, index) {
  return CONFIG.brandColors[brandId] || CONFIG.spareBrandColors[Math.max(0, index - Object.keys(CONFIG.brandColors).length) % CONFIG.spareBrandColors.length];
}
