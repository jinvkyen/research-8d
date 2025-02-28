// script.js
document.addEventListener("DOMContentLoaded", displayPreviousSearches);
// Declare global variables so they are accessible in all functions
let currentPapers = [];
let selectedPaperIndex = -1;
let searchSettings = {
  sort: "relevance", // default sort option
  sources: ["arxiv", "core", "semantic"],
  limit: 10, // default result limit
  contentType: "papers", // default content type
  // Add filters if needed:
  filters: [],
};

const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BASE_URL = isLocal ? "http://localhost:3000/api" : "/api";


function handleKeyDown(event) {
  if (event.key === "Enter") {
    openDiv();
    const query = document.getElementById("search-input").value.trim();
    if (query) {
      saveSearch(query); // Save the search when Enter is pressed
      searchPapers(); // Trigger search on Enter
    }
  }
}

function openDiv() {
  const inputField = document.getElementById("search-input").value;
  const outputDiv = document.getElementById("output");

  if (inputField.trim() === "") {
    // Show previous searches if the input is empty
    displayPreviousSearches();
    outputDiv.classList.add("hidden"); // Hide the output div
  } else {
    outputDiv.classList.remove("hidden"); // Show the output div
  }
}

async function showSuggestions() {
  const query = document.getElementById("search-input").value;
  const suggestionsList = document.getElementById("suggestionsList");

  if (!query.trim()) {
    suggestionsList.innerHTML = "";
    return;
  }

  try {
    const response = await fetch(`${BASE_URL}/autocomplete?query=${query}`);
    const suggestions = await response.json();

    suggestionsList.innerHTML = suggestions
      .map((s) => `<li class="p-2 hover:bg-gray-100 cursor-pointer" onclick="selectSuggestion('${s}')">${s}</li>`)
      .join("");
  } catch (error) {
    suggestionsList.innerHTML = "";
  }
}

function saveSearch(query) {
  if (!query.trim()) return;

  let searches = JSON.parse(localStorage.getItem("searchHistory")) || [];
  if (!searches.includes(query)) {
    searches.unshift(query);
    if (searches.length > 2) searches.pop();
    localStorage.setItem("searchHistory", JSON.stringify(searches));
  }
  displayPreviousSearches();
}

function displayPreviousSearches() {
  let searches = JSON.parse(localStorage.getItem("searchHistory")) || [];
  let searchHistoryDiv = document.getElementById("searchHistory");

  if (!searchHistoryDiv) {
    console.error("Element with ID 'searchHistory' not found.");
    return;
  }

  // Escape the search queries to prevent JS errors with quotes
  searchHistoryDiv.innerHTML = searches
    .map((search) => {
      const escapedSearch = search.replace(/'/g, "\\'").replace(/"/g, '\\"');
      return `<li class="text-blue-400 underline cursor-pointer" onclick="usePreviousSearch('${escapedSearch}')">
          <i class="ph ph-magnifying-glass"></i>
          ${search}
        </li>`;
    })
    .join("");
}

// Fixed function to handle previous search selection
function usePreviousSearch(query) {
  const searchInput = document.getElementById("search-input");
  searchInput.value = query; // Set the input value to the previous search
  openDiv(); // Update any UI state (like showing/hiding elements)

  // Add a small delay to ensure DOM is updated before search
  setTimeout(() => {
    searchPapers(); // Trigger the search API call for that query
  }, 100);
}

async function searchPapers() {
  const query = document.getElementById("search-input").value.trim();
  if (!query) return;

  saveSearch(query);

  const resultsDiv = document.getElementById("results-container");
  // Add a loading spinner instead of just text
  resultsDiv.innerHTML = `
    <div id="loading-indicator" class="py-10 text-center">
        <i class="fas fa-circle-notch loading-spinner text-indigo-600 text-4xl"></i>
        <p class="mt-4 text-gray-600">Searching academic sources...</p>
    </div>
  `;

   try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Handle non-2xx responses
    if (!response.ok) {
      const error = await response.text();
      throw new Error(error || "Search failed");
    }

    const data = await response.json();

    if (data.error) {
      showError(data.error);
    } else {
      displayResults(data.results);
    }
  } catch (error) {
    showError(error.message.includes("aborted")
      ? "Search timed out - try fewer terms"
      : error.message);
  }
}

function showError(message) {
  resultsDiv.innerHTML = `
    <div class="py-10 text-center">
      <i class="fas fa-exclamation-triangle text-red-500 text-4xl"></i>
      <p class="mt-4 text-gray-600">${message}</p>
    </div>
  `;
}

function displayResults(results) {
  const resultsDiv = document.getElementById("results-container");

  if (!results || results.length === 0) {
    resultsDiv.innerHTML = `
        <div class="text-gray-500 text-center p-6">
            <i class="ph ph-magnifying-glass text-2xl"></i>
            <p class="mt-2">No results found. Try a different search term.</p>
        </div>
        `;
    return;
  }

  // Update the global currentPapers variable so it's available to the modal function.
  currentPapers = results;

  resultsDiv.innerHTML = results
    .map(
      (result, index) => `
        <div class="border-b last:border-b-0">
        <div class="flex px-4 py-4">
            <div class="flex-1 flex items-start pr-2">
            <input type="checkbox" class="result-checkbox h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mr-3 mt-1">
            <div>
                <h3 class="font-medium text-indigo-600">
                <a href="${result.url || "#"}" target="_blank" class="hover:underline">${result.title}</a>
                </h3>
                <p class="text-sm text-gray-600 mt-1">
                ${result.authors ? result.authors.slice(0, 3).join(", ") : "Unknown authors"}
                </p>
                <p class="text-gray-500 text-sm">${result.formattedDate}</p>
            </div>
            </div>
            <div class="flex-1">
            <p class="text-left text-sm text-gray-700">
                ${result.abstract}
                <button class="cursor-pointer text-indigo-600 hover:text-indigo-800" onclick="handleViewDetails(${index})">
                View Details
                </button>
            </p>
            </div>
        </div>
        </div>
    `
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", function () {
  // DOM references
  const searchInput = document.getElementById("search-input");
  const resultsContainer = document.getElementById("results-container");
  const loadingIndicator = document.getElementById("loading-indicator");
  const noResults = document.getElementById("no-results");
  const paperModal = document.getElementById("paper-modal");
  const closeModal = document.getElementById("close-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalContent = document.getElementById("modal-content");
  const downloadPdfBtn = document.getElementById("download-pdf");
  const citationBtns = document.querySelectorAll(".citation-btn");
  const citationText = document.getElementById("citation-text");
  const selectAll = document.getElementById("select-all");
  const sortButton = document.getElementById("sort-button");
  const sortDropdown = document.getElementById("sort-dropdown");
  const sortLabel = document.getElementById("sort-label");
  const filtersButton = document.getElementById("filters-button");
  const filtersDropdown = document.getElementById("filters-dropdown");
  const contentTypeButton = document.getElementById("content-type-button");
  const contentTypeDropdown = document.getElementById("content-type-dropdown");
  const applyFilters = document.getElementById("apply-filters");
  const resultLimit = document.getElementById("result-limit");
  const limitValue = document.getElementById("limit-value");

  // Search functionality
  async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Show loading state
    loadingIndicator.classList.remove("hidden");
    resultsContainer.innerHTML = "";
    noResults.classList.add("hidden");

    try {
      const response = await fetch(`${BASE_URL}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          sources: searchSettings.sources,
          limit: searchSettings.limit,
          sort: searchSettings.sort,
          contentType: searchSettings.contentType,
        }),
      });

      const data = await response.json();
      currentPapers = data.results || [];

      // Hide loading state
      loadingIndicator.classList.add("hidden");

      if (currentPapers.length === 0) {
        noResults.classList.remove("hidden");
      } else {
        noResults.classList.add("hidden");
        displayResults();
      }
    } catch (error) {
      console.error("Error fetching search results:", error);
    }
  }

  // Now set up dropdown handlers
  function toggleDropdown(dropdown) {
    document.querySelectorAll(".z-10").forEach((el) => {
      if (el !== dropdown) el.classList.add("hidden");
    });
    dropdown.classList.toggle("hidden");
  }

  sortButton.addEventListener("click", () => toggleDropdown(sortDropdown));
  filtersButton.addEventListener("click", () => toggleDropdown(filtersDropdown));
  contentTypeButton.addEventListener("click", () => toggleDropdown(contentTypeDropdown));

  // Close dropdowns when clicking outside
  document.addEventListener("click", function (event) {
    if (!event.target.closest("#sort-button") && !event.target.closest("#sort-dropdown")) {
      sortDropdown.classList.add("hidden");
    }
    if (!event.target.closest("#filters-button") && !event.target.closest("#filters-dropdown")) {
      filtersDropdown.classList.add("hidden");
    }
    if (!event.target.closest("#content-type-button") && !event.target.closest("#content-type-dropdown")) {
      contentTypeDropdown.classList.add("hidden");
    }
  });

  // Sort option selection
  sortDropdown.querySelectorAll("div").forEach((option) => {
    option.addEventListener("click", function () {
      const value = this.getAttribute("data-value");
      sortLabel.textContent = this.textContent;
      searchSettings.sort = value;
      sortDropdown.classList.add("hidden");
      if (currentPapers.length > 0) {
        performSearch();
      }
    });
  });

  // Content type selection
  contentTypeDropdown.querySelectorAll("div").forEach((option) => {
    option.addEventListener("click", function () {
      const value = this.getAttribute("data-value");
      contentTypeButton.querySelector("span").textContent = this.textContent;
      searchSettings.contentType = value;
      contentTypeDropdown.classList.add("hidden");
      if (currentPapers.length > 0) {
        performSearch();
      }
    });
  });

  // Result limit slider
  resultLimit.addEventListener("input", function () {
    limitValue.textContent = this.value;
    searchSettings.limit = parseInt(this.value);
  });

  // Apply filters
  applyFilters.addEventListener("click", function () {
    const selectedSources = [];
    document.querySelectorAll('#filters-dropdown input[type="checkbox"]:checked').forEach((checkbox) => {
      selectedSources.push(checkbox.value);
    });

    searchSettings.sources = selectedSources;
    filtersDropdown.classList.add("hidden");

    if (currentPapers.length > 0) {
      performSearch();
    }
  });

  // Custom checkbox styling
  document.querySelectorAll(".custom-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      const label = document.querySelector(`label[for="${this.id}"].checkbox-label`);
      if (this.checked) {
        label.innerHTML = '<i class="fas fa-check text-white"></i>';
      } else {
        label.innerHTML = "";
      }
    });

    // Initialize checkboxes
    const event = new Event("change");
    checkbox.dispatchEvent(event);
  });

  window.handleViewDetails = function (index) {
    selectedPaperIndex = index;
    openPaperModal();
  };

  function openPaperModal() {
    const paper = currentPapers[selectedPaperIndex];
    if (!paper) {
      console.error("No paper found at index", selectedPaperIndex);
      return;
    }
    modalTitle.textContent = paper.title;
    modalContent.innerHTML = `
        <p><strong>Authors:</strong> ${paper.authors.join(", ")}</p>
        <p><strong>Abstract:</strong> ${paper.abstract}</p>
        <p><strong>Published in:</strong> ${paper.formattedDate}</p>
        <p><strong>Category:</strong> ${paper.categories}</p>
        <p><strong>Source:</strong> <a class="underline text-indigo-600 hover:text-indigo-500" href="${
          paper.url
        }" target="_blank" rel="noopener noreferrer">${paper.url}</a></p>`;
    paperModal.classList.remove("hidden");
  }

  // Close modal
  closeModal.addEventListener("click", function () {
    paperModal.classList.add("hidden");
    paperModal.classList.add("cursor-pointer");
  });

  // Download PDF button functionality
  downloadPdfBtn.addEventListener("click", function () {
    const paper = currentPapers[selectedPaperIndex];
    if (paper.pdfUrl) {
      window.open(paper.pdfUrl, "_blank");
    } else {
      alert("PDF not available for this paper.");
    }
  });

  // Citation button functionality
  citationBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      const format = this.getAttribute("data-format");
      const paper = currentPapers[selectedPaperIndex];
      citationText.textContent = generateCitation(paper, format);
    });
  });

  // Generate citation based on format
  function generateCitation(paper, format) {
    switch (format) {
      case "apa":
        return `${paper.authors.join(", ")}. (${paper.year}). ${paper.title}. ${paper.journal}.`;
      case "mla":
        return `${paper.authors.join(", ")}. "${paper.title}." ${paper.journal}, ${paper.year}.`;
      case "chicago":
        return `${paper.authors.join(", ")}. "${paper.title}." ${paper.journal} (${paper.year}).`;
      default:
        return "";
    }
  }

  // Add event listeners to citation buttons
  document.querySelectorAll(".citation-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const format = button.getAttribute("data-format");
      const citationText = generateCitation(currentPapers[selectedPaperIndex], format);
      document.getElementById("citation-text").textContent = citationText;
    });
  });

  // Add event listener for the copy button
  document.getElementById("copy-button").addEventListener("click", () => {
    const citationText = document.getElementById("citation-text").textContent;
    if (citationText) {
      navigator.clipboard
        .writeText(citationText)
        .then(() => {
          alert("Citation copied to clipboard!");
        })
        .catch((err) => {
          console.error("Failed to copy: ", err);
        });
    } else {
      alert("No citation to copy!");
    }
  });

  // Search on input change
  searchInput.addEventListener("input", function () {
    if (this.value.trim()) {
      displayPreviousSearches();
    } else {
      resultsContainer.innerHTML = "";
      noResults.classList.add("hidden");
    }
  });

  selectAll.addEventListener("change", function () {
    const checkboxes = document.querySelectorAll(".result-checkbox");
    checkboxes.forEach((checkbox) => {
      checkbox.checked = selectAll.checked;
    });
  });
});

function clearSearchHistory() {
  localStorage.removeItem("searchHistory");
  document.getElementById("searchHistory").innerHTML = "";
}
window.handleViewDetails = function (index) {
  selectedPaperIndex = index;
  openPaperModal();
};
