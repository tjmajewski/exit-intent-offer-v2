// Pre-aimed searches for finding who runs a store.
//
// Shared by the research page and the slide deck so both point at the same
// places. Nothing here fetches anything: these are links for a person to open.
// LinkedIn in particular must not be scraped, and does not need to be.

export function prettyBrand(domain, storeName) {
  if (storeName) return storeName;
  return domain.replace(/\.[a-z.]+$/, '').replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// A site:linkedin.com/in Google search beats LinkedIn's own search for this:
// it needs no login, ranks the obvious profile first, and shows the headline
// in the result, which is usually enough to confirm the person runs the store.
export function researchLinks(domain, storeName, found = {}) {
  const brand = prettyBrand(domain, storeName);
  const q = encodeURIComponent;
  const links = [
    ['Google: LinkedIn profiles', `https://www.google.com/search?q=${q(`site:linkedin.com/in "${brand}" (founder OR owner OR CEO OR "head of ecommerce")`)}`],
    ['LinkedIn people', `https://www.linkedin.com/search/results/people/?keywords=${q(brand)}`],
    ['LinkedIn company', `https://www.linkedin.com/search/results/companies/?keywords=${q(brand)}`],
    ['Google: who owns it', `https://www.google.com/search?q=${q(`"${brand}" founder OR owner interview`)}`],
    ['Store contact page', `https://${domain}/pages/contact`],
  ];
  if (found.instagram) links.splice(3, 0, ['Instagram bio', `https://instagram.com/${found.instagram}`]);
  if (found.name) {
    links.unshift(['Google: this name', `https://www.google.com/search?q=${q(`"${found.name}" "${brand}" linkedin`)}`]);
  }
  return links;
}
