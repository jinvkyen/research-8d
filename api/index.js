// index.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const path = require("path");
const { parseString } = require("xml2js");
require("dotenv").config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Serve the entire project root (one level up from /api)
app.use(express.static(path.join(__dirname, "..")));

// If you specifically want index.html from the root:
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// API Keys from .env
const HFF_API_KEY = process.env.HFF_API_KEY;
const CORE_API_KEY = process.env.CORE_API_KEY;
const SUMMARIZATION_URL = process.env.SUMMARIZATION_URL;

// Fetch from multiple sources
const API_TIMEOUT = 8000; // 8 seconds per external API call
const MAX_RESULTS = 25; // Prevent excessive result limits

// Modified fetchPapers with timeout handling
async function fetchPapers(query, sources = ["arxiv", "core", "semantic"], limit = 5) {
  const results = [];
  const controller = new AbortController();

  try {
    const fetchPromises = [];

    if (sources.includes("arxiv")) {
      fetchPromises.push(fetchWithTimeout(() => fetchArxivPapers(query, limit, controller.signal), API_TIMEOUT));
    }

    if (sources.includes("core") && CORE_API_KEY) {
      fetchPromises.push(fetchWithTimeout(() => fetchCorePapers(query, limit, controller.signal), API_TIMEOUT));
    }

    if (sources.includes("semantic")) {
      fetchPromises.push(
        fetchWithTimeout(() => fetchSemanticScholarPapers(query, limit, controller.signal), API_TIMEOUT)
      );
    }

    // Race all API calls against timeout and each other
    const settledResults = await Promise.allSettled(fetchPromises);

    // Process successful results
    settledResults.forEach((result) => {
      if (result.status === "fulfilled") {
        results.push(...result.value);
      }
    });

    // Deduplication
    const uniqueResults = [];
    const titles = new Set();

    for (const paper of results) {
      const normalizedTitle = paper.title?.toLowerCase().trim() || "";
      if (!titles.has(normalizedTitle)) {
        // Fixed missing parenthesis
        titles.add(normalizedTitle);
        uniqueResults.push(paper);
      }
    }

    // Sorting
    uniqueResults.sort((a, b) => new Date(b.date) - new Date(a.date));

    return uniqueResults.slice(0, limit);
  } catch (error) {
    controller.abort();
    console.error("Fetch error:", error);
    return [];
  }
}
// Generic timeout wrapper
async function fetchWithTimeout(fetcher, timeout) {
  return Promise.race([
    fetcher(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("API timeout")), timeout)
    )
  ]);
}

// Fetch Papers from arXiv
async function fetchArxivPapers(query, limit = 5, signal) {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}`;
    const response = await axios.get(url, {
      signal,
      timeout: API_TIMEOUT,
    });

    return new Promise((resolve, reject) => {
      parseString(response.data, (err, result) => {
        if (err) {
          console.error("Error parsing arXiv response:", err);
          reject([]);
        } else {
          const entries = result.feed?.entry || [];
          const papers = entries.map((entry) => {
            const publishedDateRaw = entry.published[0]; // e.g., "2024-07-05T14:36:19Z"
            const parsedDate = new Date(publishedDateRaw);
            let formattedDate = "Unknown";
            if (!isNaN(parsedDate)) {
              formattedDate = parsedDate.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              });
            }
            return {
              title: entry.title[0],
              authors: entry.author.map((a) => a.name[0]),
              abstract: entry.summary[0],
              date: publishedDateRaw,
              formattedDate, // e.g., "July 5, 2024"
              year: isNaN(parsedDate.getFullYear()) ? "Unknown" : parsedDate.getFullYear(),
              journal: entry["arxiv:journal_ref"]?.[0] || "N/A",
              url: entry.id[0],
              pdfUrl: entry.link.find((l) => l.$?.title === "pdf")?.$.href || null,
              source: "arXiv",
              id: entry.id[0],
              categories: entry.category?.map((c) => c.$.term).join(", ") || "",
            };
          });
          resolve(papers);
        }
      });
    });
  } catch (error) {
    if (!axios.isCancel(error)) {
      console.error("arXiv error:", error.message);
    }
    return [];
  }
}


// Fetch Papers from CORE
async function fetchCorePapers(query, limit = 5) {
  if (!CORE_API_KEY) {
    console.warn("CORE API key not found. Skipping CORE search.");
    return [];
  }

  try {
    const response = await axios.get("https://api.core.ac.uk/v3/search/works", {
      params: {
        q: query,
        limit: limit,
      },
      headers: {
        Authorization: `Bearer ${CORE_API_KEY}`,
      },
    });

    return response.data.results.map((paper) => {
      const publishedDate = paper.publishedDate; // e.g., "2024-07-05T14:36:19Z"
      let formattedDate = "Unknown";
      let year = "Unknown";
      if (publishedDate) {
        const parsedDate = new Date(publishedDate);
        if (!isNaN(parsedDate)) {
          formattedDate = parsedDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          year = parsedDate.getFullYear();
        }
      }
      return {
        title: paper.title || "No title",
        authors: paper.authors?.map((a) => a.name) || [],
        abstract: paper.abstract || "No abstract available",
        date: publishedDate || "Unknown date",
        formattedDate, // e.g., "July 5, 2024"
        year,
        journal: paper.journal ? paper.journal : "N/A",
        url: paper.downloadUrl || paper.sourceUrl || null,
        pdfUrl: paper.downloadUrl || null,
        source: "CORE",
        id: paper.id,
        categories: paper.topics?.join(", ") || "",
      };
    });
  } catch (error) {
    console.error("CORE API Error:", error.message);
    return [];
  }
}


// Fetch Papers from Semantic Scholar
async function fetchSemanticScholarPapers(query, limit = 5, signal) {
  try {
    const response = await axios.get("https://api.semanticscholar.org/graph/v1/paper/search", {
      params: {
        query: query,
        limit: limit,
        fields: "title,authors,abstract,year,url,venue,publicationDate",
      },
      signal,
      timeout: API_TIMEOUT,
    });

    return response.data.data.map((paper) => {
      // Use publicationDate if available, otherwise fall back to year
      const publishedDate = paper.publicationDate || (paper.year ? paper.year.toString() : "Unknown date");
      let formattedDate = "Unknown";
      let year = "Unknown";
      if (paper.publicationDate) {
        const parsedDate = new Date(paper.publicationDate);
        if (!isNaN(parsedDate)) {
          formattedDate = parsedDate.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          year = parsedDate.getFullYear();
        }
      } else if (paper.year) {
        // If only a year is provided
        year = paper.year;
        formattedDate = paper.year.toString();
      }
      return {
        title: paper.title || "No title",
        authors: paper.authors?.map((a) => a.name) || [],
        abstract: paper.abstract || "No abstract available",
        date: publishedDate,
        formattedDate,
        year,
        journal: paper.venue || "N/A",
        url: paper.url || null,
        pdfUrl: paper.openAccessPdf?.url || null,
        source: "Semantic Scholar",
        id: paper.paperId,
        categories: paper.venue || "",
      };
    });
  } catch (error) {
    console.error("Semantic Scholar API Error:", error.message);
    return [];
  }
}


// Summarization Helper
async function summarizeText(text) {
  try {
    if (!text || text.length < 50) return text;

    // Truncate very long abstracts for API limits
    const truncatedText = text.length > 1000 ? text.substring(0, 1000) + "..." : text;

    const response = await axios.post(
      SUMMARIZATION_URL,
      { inputs: truncatedText, parameters: { max_length: 150 } },
      {
        headers: {
          Authorization: `Bearer ${HFF_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data[0]?.summary_text || text.substring(0, 150) + "...";
  } catch (error) {
    console.error("Summarization failed:", error.response?.data || error.message);
    return text.substring(0, 150) + "...";
  }
}

// Generate citations in different formats
function generateCitation(paper, format = "apa") {
  const authors = paper.authors || [];
  const title = paper.title || "Untitled";
  const date = paper.date ? new Date(paper.date) : new Date();
  const year = date.getFullYear();
  const url = paper.url || "";

  switch (format.toLowerCase()) {
    case "apa":
      return `${authors.length ? authors.join(", ") : "Unknown"} (${year}). ${title}. Retrieved from ${url}`;

    case "mla":
      return `${
        authors.length ? authors[0] : "Unknown"
      }, et al. "${title}." ${year}. Web. ${new Date().toLocaleDateString()}.`;

    case "chicago":
      return `${authors.length ? authors.join(", ") : "Unknown"}. "${title}." ${year}. ${url}.`;

    default:
      return `${authors.length ? authors.join(", ") : "Unknown"} (${year}). ${title}.`;
  }
}

// Search Endpoint with timeout protection
app.post("/api/search", async (req, res) => {
  const startTime = Date.now();
  try {
    const { query, sources = ["arxiv"], limit = 10, sort = "relevance" } = req.body;

    // Validate input
    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: "Query must be at least 2 characters" });
    }

    if (limit > MAX_RESULTS) {
      return res.status(400).json({ error: `Maximum results limit is ${MAX_RESULTS}` });
    }

    // Setup timeout protection
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Search timeout")), 9000)
    );

    const searchPromise = (async () => {
      const papers = await fetchPapers(query, sources, Math.min(limit, MAX_RESULTS));

      // Sort results
      if (sort === "date") {
        papers.sort((a, b) => new Date(b.date) - new Date(a.date));
      }

      // Parallel processing with safety
      const enhancedPapers = await Promise.allSettled(
        papers.map(async paper => ({
          ...paper,
          insight: await summarizeText(paper.abstract)
        }))
      );

      return enhancedPapers
        .filter(result => result.status === "fulfilled")
        .map(result => result.value);
    })();

    const papers = await Promise.race([searchPromise, timeoutPromise]);

    // Generate citations
    const results = papers.map(paper => ({
      ...paper,
      citations: ["apa", "mla", "chicago"].reduce((acc, style) => {
        acc[style] = generateCitation(paper, style);
        return acc;
      }, {})
    }));

    console.log(`Search completed in ${Date.now() - startTime}ms`);
    res.json({ results });

  } catch (error) {
    console.error(`Search failed after ${Date.now() - startTime}ms:`, error);
    const statusCode = error.message.includes("timeout") ? 504 : 500;
    res.status(statusCode).json({
      error: error.message.includes("timeout")
        ? "Search took too long - try simplifying your query"
        : "Search failed",
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
});

// Paper Details Endpoint with improved error handling
app.get("/api/paper/:id", async (req, res) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const { id } = req.params;
    const { source = "arxiv" } = req.query;

    if (!id) return res.status(400).json({ error: "Paper ID required" });

    let paperDetails = null;

    if (source === "arxiv") {
      const response = await axios.get(
        `http://export.arxiv.org/api/query?id_list=${id}`,
        { signal: controller.signal, timeout: API_TIMEOUT }
      );

      paperDetails = await new Promise((resolve, reject) => {
        parseString(response.data, (err, result) => {
          if (err) return reject(err);
          const entry = result.feed?.entry?.[0];
          if (!entry) return reject(new Error("Paper not found"));

          resolve(parseArxivEntry(entry));
        });
      });
    }

    if (!paperDetails) {
      return res.status(404).json({ error: "Paper not found or source not supported" });
    }

    clearTimeout(timeoutId);
    res.json({ paper: paperDetails });

  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Paper details error:", error);

    const statusCode = axios.isCancel(error) ? 504 : 500;
    res.status(statusCode).json({
      error: axios.isCancel(error)
        ? "Paper details request timed out"
        : "Failed to retrieve paper details",
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  }
});

function parseArxivEntry(entry) {
  const publishedDateRaw = entry.published[0];
  const parsedDate = new Date(publishedDateRaw);

  return {
    title: entry.title[0],
    authors: entry.author.map((a) => a.name[0]),
    abstract: entry.summary[0],
    date: publishedDateRaw,
    formattedDate: isNaN(parsedDate)
      ? "Unknown"
      : parsedDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
    year: isNaN(parsedDate) ? "Unknown" : parsedDate.getFullYear(),
    journal: entry["arxiv:journal_ref"]?.[0] || "N/A",
    url: entry.id[0],
    pdfUrl: entry.link.find((l) => l.$.title === "pdf")?.$.href || null,
    categories: entry.category?.map((c) => c.$.term).join(", ") || "",
    source: "arXiv",
  };
}

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
console.log("HFF_API_KEY:", HFF_API_KEY);