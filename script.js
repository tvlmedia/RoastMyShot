const imageInput = document.getElementById("imageInput");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const roastButton = document.getElementById("roastButton");
const roastLevel = document.getElementById("roastLevel");
const styleGoal = document.getElementById("styleGoal");
const languageSelect = document.getElementById("languageSelect");
const levelDescription = document.getElementById("levelDescription");

const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const resultState = document.getElementById("resultState");

const cinemaScore = document.getElementById("cinemaScore");
const brutalityScore = document.getElementById("brutalityScore");
const oneLinerRoast = document.getElementById("oneLinerRoast");
const strengthsList = document.getElementById("strengthsList");
const problemsList = document.getElementById("problemsList");
const fixesList = document.getElementById("fixesList");
const finalVerdict = document.getElementById("finalVerdict");

let uploadedImageBase64 = null;
const MAX_IMAGE_HEIGHT = 1080;
const OUTPUT_IMAGE_MIME = "image/jpeg";
const OUTPUT_IMAGE_QUALITY = 0.82;

const levelDescriptions = {
  nl: {
    mother: "Ziet vooral potentie en wil je niet kwetsen.",
    honest: "Zegt gewoon wat werkt en wat niet.",
    hard: "Een scherpe docent met weinig geduld.",
    merciless: "Roast eerst, nuance later.",
    timo: "Alles wat laf, veilig of halfbakken is wordt afgemaakt."
  },
  en: {
    mother: "Sees your potential and does not want to hurt your feelings.",
    honest: "Says what works and what does not.",
    hard: "A sharp teacher with little patience.",
    merciless: "Roasts first, nuance later.",
    timo: "Anything safe, timid, or half-baked gets destroyed."
  }
};

imageInput.addEventListener("change", handleImageUpload);
roastButton.addEventListener("click", handleRoast);
roastLevel.addEventListener("change", updateLevelDescription);
languageSelect.addEventListener("change", updateLevelDescription);

updateLevelDescription();

function updateLevelDescription() {
  const language = languageSelect?.value || "nl";
  levelDescription.textContent = levelDescriptions[language]?.[roastLevel.value] || "";
}

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Upload eerst gewoon een image file.");
    return;
  }

  const reader = new FileReader();

  reader.onload = async function (e) {
    try {
      const sourceDataUrl = e.target.result;
      uploadedImageBase64 = await resizeImageToMaxHeight(sourceDataUrl, MAX_IMAGE_HEIGHT);
      previewImage.src = uploadedImageBase64;
      previewWrap.classList.remove("hidden");
      roastButton.disabled = false;

      emptyState.classList.remove("hidden");
      loadingState.classList.add("hidden");
      resultState.classList.add("hidden");
    } catch (error) {
      console.error(error);
      alert("De afbeelding kon niet verwerkt worden.");
      roastButton.disabled = true;
    }
  };

  reader.readAsDataURL(file);
}

function resizeImageToMaxHeight(dataUrl, maxHeight) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      const shouldResize = image.height > maxHeight;
      const scale = shouldResize ? maxHeight / image.height : 1;
      const targetHeight = shouldResize ? maxHeight : image.height;
      const targetWidth = Math.max(1, Math.round(image.width * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("Canvas context unavailable"));
        return;
      }

      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      const resizedDataUrl = canvas.toDataURL(OUTPUT_IMAGE_MIME, OUTPUT_IMAGE_QUALITY);

      resolve(resizedDataUrl);
    };

    image.onerror = () => reject(new Error("Image could not be loaded for resize"));
    image.src = dataUrl;
  });
}

async function handleRoast() {
  if (!uploadedImageBase64) return;

  showLoading();

  try {
    const response = await fetch("/api/roast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        image: uploadedImageBase64,
        roastLevel: roastLevel.value,
        styleGoal: styleGoal.value,
        language: languageSelect?.value || "nl"
      })
    });

    const rawBody = await response.text();
    let data = null;
    try {
      data = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      const fallbackMsg = `Server gaf geen geldige JSON response (HTTP ${response.status}).`;
      throw new Error(fallbackMsg);
    }

    if (!response.ok) {
      if (response.status === 413) {
        throw new Error("Afbeelding is nog te groot voor de server (HTTP 413). Probeer een kleinere/lager gecomprimeerde afbeelding.");
      }
      throw new Error(data?.error || "Er ging iets mis met de roast API.");
    }

    renderResult(data);
  } catch (error) {
    console.error(error);
    alert(error.message || "Er ging iets mis bij het roasten van je shot.");
    showEmpty();
  }
}

function showLoading() {
  emptyState.classList.add("hidden");
  resultState.classList.add("hidden");
  loadingState.classList.remove("hidden");
}

function showEmpty() {
  loadingState.classList.add("hidden");
  resultState.classList.add("hidden");
  emptyState.classList.remove("hidden");
}

function renderResult(data) {
  loadingState.classList.add("hidden");
  emptyState.classList.add("hidden");
  resultState.classList.remove("hidden");

  cinemaScore.textContent = `Cinema Score: ${data.cinema_score}/10`;
  brutalityScore.textContent = `Brutality: ${data.brutality_score}/10`;
  oneLinerRoast.textContent = data.one_liner_roast;
  adjustOneLinerSize(data.one_liner_roast);
  finalVerdict.textContent = data.final_verdict;

  fillList(strengthsList, data.strengths);
  fillList(problemsList, data.problems);
  fillList(fixesList, data.fixes);
}

function adjustOneLinerSize(text) {
  oneLinerRoast.classList.remove("size-md", "size-sm", "size-xs", "size-xxs");

  const length = (text || "").trim().length;
  if (length > 320) {
    oneLinerRoast.classList.add("size-xxs");
    return;
  }

  if (length > 240) {
    oneLinerRoast.classList.add("size-xs");
    return;
  }

  if (length > 170) {
    oneLinerRoast.classList.add("size-sm");
    return;
  }

  if (length > 120) {
    oneLinerRoast.classList.add("size-md");
  }
}

function fillList(element, items) {
  element.innerHTML = "";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  });
}
