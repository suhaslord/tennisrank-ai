// Route Google Sheets through the app backend so browser CORS/network policies
// cannot break public spreadsheet imports.
(() => {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input, init) => {
    try {
      const requestUrl = typeof input === "string" || input instanceof URL
        ? new URL(String(input), window.location.href)
        : new URL(input.url, window.location.href);

      if (requestUrl.hostname === "docs.google.com" && requestUrl.pathname.includes("/spreadsheets/")) {
        const proxyUrl = `/api/sheet?url=${encodeURIComponent(requestUrl.href)}`;
        return nativeFetch(proxyUrl, init);
      }
    } catch {
      // Fall through to the browser's normal fetch behavior.
    }

    return nativeFetch(input, init);
  };
})();
