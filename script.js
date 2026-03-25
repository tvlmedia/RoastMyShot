const imageInput = document.getElementById("imageInput");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const roastButton = document.getElementById("roastButton");
const roastLevel = document.getElementById("roastLevel");
const styleGoal = document.getElementById("styleGoal");

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

imageInput.addEventListener("change", handleImageUpload);
roastButton.addEventListener("click", handleRoast);

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Upload eerst gewoon een image file.");
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    uploadedImageBase64 = e.target.result;
    previewImage.src = uploadedImageBase64;
    previewWrap.classList.remove("hidden");
    roastButton.disabled = false;

    emptyState.classList.remove("hidden");
    loadingState.classList.add("hidden");
    resultState.classList.add("hidden");
  };

  reader.readAsDataURL(file);
}

async function handleRoast() {
  if (!uploadedImageBase64) return;

  showLoading();

  try {
    // MOCK RESULT FOR V1 FRONTEND
    // Later vervangen we dit door een echte fetch() naar jouw backend endpoint.
    await delay(1600);

    const mockResult = generateMockRoast({
      roastLevel: roastLevel.value,
      styleGoal: styleGoal.value
    });

    renderResult(mockResult);
  } catch (error) {
    console.error(error);
    alert("Er ging iets mis bij het roasten van je shot.");
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
  finalVerdict.textContent = data.final_verdict;

  fillList(strengthsList, data.strengths, false);
  fillList(problemsList, data.problems, false);
  fillList(fixesList, data.fixes, true);
}

function fillList(element, items, ordered = false) {
  element.innerHTML = "";

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    element.appendChild(li);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateMockRoast({ roastLevel, styleGoal }) {
  const roastMap = {
    honest: {
      oneLiner: "Dit frame werkt wel een beetje, maar het voelt nog alsof je vooral hebt geregistreerd in plaats van gekozen.",
      brutality: 5
    },
    hard: {
      oneLiner: "Dit is geen cinematografie, dit is een beveiligingscamera met artistieke ambities.",
      brutality: 8
    },
    merciless: {
      oneLiner: "Je shot oogt alsof niemand op set de moed had om dichterbij te gaan staan of een echte keuze te maken.",
      brutality: 10
    }
  };

  const styleFixMap = {
    cinematic: "Maak de belichting directioneler en zorg dat je subject duidelijker loskomt van de achtergrond.",
    commercial: "Maak het cleaner, gecontroleerder en visueel duurder met meer shape in het licht.",
    raw: "Laat het minder netjes voelen en durf dichter op je onderwerp te kruipen.",
    arthouse: "Maak het kader gedurfder en laat negatieve ruimte echt betekenis dragen.",
    intimate: "Ga dichter op je subject zitten en maak de camera-emotie persoonlijker."
  };

  return {
    one_liner_roast: roastMap[roastLevel].oneLiner,
    cinema_score: 5.8,
    brutality_score: roastMap[roastLevel].brutality,
    strengths: [
      "Het onderwerp is in ieder geval leesbaar en het frame is niet compleet chaotisch.",
      "Er zit een basisidee in het shot, dus het voelt niet volledig willekeurig.",
      "Exposure lijkt bruikbaar genoeg om mee verder te werken."
    ],
    problems: [
      "De compositie voelt te veilig en te centraal, waardoor het shot weinig karakter heeft.",
      "Het licht mist richting, waardoor het beeld vlak aanvoelt.",
      "De achtergrond doet inhoudelijk weinig en helpt je onderwerp niet.",
      "Er is te weinig visuele spanning tussen voorgrond, subject en achtergrond."
    ],
    fixes: [
      "Verplaats je onderwerp uit het dode midden tenzij daar echt een inhoudelijke reden voor is.",
      "Maak de achtergrond subtiel donkerder of rustiger zodat je subject meer loskomt.",
      "Kies een duidelijkere camerahoogte: lager, hoger, of dichterbij — maar niet deze neutrale twijfelstand.",
      styleFixMap[styleGoal]
    ],
    final_verdict:
      "Bruikbaar als registrerend shot, maar nog niet sterk genoeg om echt filmisch of uitgesproken te voelen. Er is vooral meer keuze nodig."
  };
}

/*
  LATER VERVANGEN DOOR ZOETS ALS:

  async function handleRoast() {
    if (!uploadedImageBase64) return;
    showLoading();

    try {
      const response = await fetch("https://jouw-backend-url.vercel.app/api/roast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image: uploadedImageBase64,
          roastLevel: roastLevel.value,
          styleGoal: styleGoal.value
        })
      });

      if (!response.ok) {
        throw new Error("API request failed");
      }

      const data = await response.json();
      renderResult(data);
    } catch (error) {
      console.error(error);
      alert("Er ging iets mis bij de AI roast.");
      showEmpty();
    }
  }
*/
