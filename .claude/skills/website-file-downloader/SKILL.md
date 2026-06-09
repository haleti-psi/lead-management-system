---
name: website-file-downloader
description: >
  Bulk download files from any website's document/download section. Use this skill whenever the user wants to
  download multiple files from a website, scrape documents from a government portal, archive downloadable files
  from a page, or batch-download PDFs/docs/spreadsheets from any URL. Trigger phrases include: "download all files
  from this website", "grab the documents from this page", "save all PDFs from this URL", "bulk download",
  "download everything from the documents tab", "scrape files from a portal", or any request involving downloading
  multiple files from a web page — even if the user just pastes a URL and says "get me all the files here".
  Also use when the user mentions government document portals, ministry websites, resource libraries, or any
  page with a list of downloadable resources. If a user provides a URL and mentions downloading, this is your skill.
---

# Website File Downloader

Download all files from a website's document/resource section to a local directory. This skill handles the full
pipeline: navigating to the page, discovering all downloadable links (across multiple pages if paginated),
presenting a summary for user confirmation, and then downloading everything.

## Why This Approach

Websites vary wildly — some have simple link lists, others use JavaScript-rendered tables, pagination, tabs, or
even nested sub-pages. A purely CLI approach (just running wget) often misses dynamically loaded content. A purely
browser approach is slow for actual downloads. The hybrid strategy here gets the best of both worlds: use the
browser to see the page the way a human would (catching JS-rendered content, pagination, etc.), then hand off the
actual file downloads to fast CLI tools.

## Step-by-Step Workflow

### 1. Understand What the User Wants

Before doing anything, clarify:

- **URL**: Which page to download from (the user should provide this)
- **Download directory**: Where to save files. Default to the user's mounted folder if available, or ask where they'd like files saved. Use `request_cowork_directory` if no folder is mounted yet.
- **File type filter** (optional): Does the user want everything, or only specific types (PDFs, docs, etc.)?
- **Scope**: Just this page, or follow sub-links/pagination too?

If the user already gave a clear URL and seems to want "everything," don't over-ask — just confirm the download directory and proceed.

### 2. Navigate to the Page with Chrome

Use the browser automation tools to open the target URL:

```
1. Get browser context: tabs_context_mcp (createIfEmpty: true)
2. Create a new tab: tabs_create_mcp
3. Navigate to the URL: navigate(url, tabId)
4. Wait briefly for the page to load: computer(action: "wait", duration: 3)
5. Take a screenshot to verify the page loaded correctly
```

If the page has a specific "Documents" or "Downloads" tab/section, click into it first before extracting links.

### 3. Extract All Download Links

Use JavaScript execution to pull all downloadable links from the page. This is more reliable than trying to
read the accessibility tree for links, because it can catch dynamically generated content.

Run this script via `javascript_tool`:

```javascript
(() => {
  const fileExtensions = [
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',
    'zip', 'rar', '7z', 'tar', 'gz',
    'txt', 'rtf', 'odt', 'ods', 'odp',
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp',
    'mp3', 'mp4', 'avi', 'mov', 'wmv',
    'exe', 'msi', 'dmg', 'apk',
    'json', 'xml', 'yaml', 'yml'
  ];

  const links = Array.from(document.querySelectorAll('a[href]'));
  const downloadLinks = [];

  for (const link of links) {
    const href = link.href;
    const text = link.textContent.trim();

    // Check if link points to a downloadable file
    const url = new URL(href, window.location.origin);
    const pathname = url.pathname.toLowerCase();
    const hasFileExt = fileExtensions.some(ext => pathname.endsWith('.' + ext));

    // Also check for download attributes or common download URL patterns
    const hasDownloadAttr = link.hasAttribute('download');
    const looksLikeDownload = /download|attachment|file_get|getfile|fetch_doc/i.test(href);

    if (hasFileExt || hasDownloadAttr || looksLikeDownload) {
      const ext = pathname.split('.').pop() || 'unknown';
      downloadLinks.push({
        url: href,
        text: text || 'Untitled',
        extension: hasFileExt ? ext : 'unknown',
        filename: pathname.split('/').pop() || text || 'file'
      });
    }
  }

  // Deduplicate by URL
  const unique = [...new Map(downloadLinks.map(d => [d.url, d])).values()];
  JSON.stringify(unique, null, 2);
})()
```

**Important**: Some sites use `onclick` handlers or `<button>` elements for downloads instead of `<a>` tags. If the
initial extraction finds zero links, fall back to:

1. Look for buttons/elements with download-related text using `find("download buttons or links")`
2. Check for `<iframe>` elements that might embed documents
3. Look at the page text with `get_page_text` to find URLs mentioned in text

### 4. Handle Pagination

Many document portals spread files across multiple pages. After extracting links from the current page, check
for pagination:

```javascript
(() => {
  // Look for common pagination patterns
  const nextSelectors = [
    'a[rel="next"]',
    '.pagination .next a',
    '.pager .next a',
    'a.next-page',
    'li.next a',
    '[aria-label="Next"]',
    '[aria-label="Next page"]',
    'a:has(> span.next)',
  ];

  for (const sel of nextSelectors) {
    const el = document.querySelector(sel);
    if (el && el.href) return JSON.stringify({ found: true, href: el.href, selector: sel });
  }

  // Also check for numbered page links
  const pageLinks = document.querySelectorAll('.pagination a, .pager a, nav[aria-label*="page"] a');
  if (pageLinks.length > 0) {
    const pages = Array.from(pageLinks).map(a => ({ text: a.textContent.trim(), href: a.href }));
    return JSON.stringify({ found: true, type: 'numbered', pages });
  }

  return JSON.stringify({ found: false });
})()
```

If pagination exists, iterate through all pages:

1. Collect links from the current page
2. Click "Next" or navigate to the next page number
3. Wait for the page to load (2-3 seconds)
4. Extract links again
5. Repeat until there's no more "Next" or all page numbers are visited

Keep a running list of all discovered links across pages, deduplicating by URL.

### 5. Present Summary and Get User Confirmation

Before downloading anything, present the user with a summary. This is important — the user should confirm before
files start hitting their disk.

Show something like:

> **Found 47 files across 5 pages:**
> - 32 PDFs
> - 8 XLSX files
> - 4 DOCX files
> - 3 ZIP archives
>
> Total: 47 files. Shall I download all of them to [directory]?

If the user wants to filter (e.g., "just the PDFs"), apply the filter before proceeding.

**You must wait for user confirmation before downloading.**

### 6. Download Files

Once confirmed, use `wget` or `curl` in Bash to download files. This is faster and more reliable than clicking
download buttons in the browser.

Create a download script that:

1. Creates the target directory if needed
2. Downloads files one by one with progress indication
3. Handles filename collisions (append a number if a file already exists)
4. Retries failed downloads once
5. Logs results

```bash
# Example download loop
DOWNLOAD_DIR="/path/to/downloads"
mkdir -p "$DOWNLOAD_DIR"

# Download with wget, preserving original filename, with retry
wget --no-check-certificate \
     --content-disposition \
     --tries=2 \
     --timeout=30 \
     -P "$DOWNLOAD_DIR" \
     "FILE_URL"
```

For each file:

- Use `--content-disposition` so the server can suggest the right filename
- Use `--no-clobber` or handle duplicates manually
- Set a reasonable timeout (30s) so one stuck file doesn't block everything
- Print progress: "Downloading file 3/47: annual-report-2024.pdf"

If wget is not available, fall back to curl:

```bash
curl -L -o "$DOWNLOAD_DIR/filename.pdf" \
     --retry 2 \
     --connect-timeout 30 \
     "FILE_URL"
```

**Cookie/session handling**: Some government sites require cookies/session to be maintained. If downloads fail
with 403 errors, you may need to:

1. Export cookies from the browser session using `javascript_tool`:
   ```javascript
   document.cookie
   ```
2. Pass them to wget/curl:
   ```bash
   wget --header="Cookie: session_id=abc123" "FILE_URL"
   ```

### 7. Report Results

After all downloads complete, give the user a clear summary:

> **Download complete!**
> - Successfully downloaded: 45/47 files
> - Failed: 2 files (listed below with reasons)
> - Total size: ~142 MB
> - Saved to: [directory path]
>
> Failed files:
> 1. report-2019.pdf — 404 Not Found (link may be broken)
> 2. data-archive.zip — Timeout after 30s (file may be too large)

Also list a few of the downloaded files so the user can verify things look right.

## Edge Cases & Troubleshooting

**Dynamic/JavaScript-heavy sites**: If the initial page load doesn't show all content, try:
- Scrolling down to trigger lazy loading
- Waiting longer (5-10 seconds) for JS to execute
- Looking for "Load More" buttons and clicking them

**Login-required sites**: If the page requires authentication, tell the user they need to log in first in the
browser, then retry. Don't attempt to handle login credentials.

**Very large file counts (100+)**: For sites with hundreds of files, batch the downloads and give periodic
progress updates (every 10-20 files). Consider asking the user if they want to download in batches.

**Rate limiting**: Some sites throttle downloads. If you start getting 429 errors, add a small delay (2-3s)
between downloads:
```bash
sleep 2
```

**File naming**: Government and institutional sites often have terrible filenames like `download.php?id=4523`.
The `--content-disposition` flag usually handles this, but if filenames are still bad, try to extract better
names from the link text on the page.

## Important Notes

- Always get user confirmation before starting downloads
- Respect the website's robots.txt and rate limits — don't hammer servers
- If a site appears to actively block scraping, inform the user rather than trying to bypass protections
- Keep the user informed of progress during long download sessions
- If the mounted folder isn't writable or doesn't exist, ask the user where to save files
