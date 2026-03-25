const imageInput = document.getElementById("imageInput");
const previewWrap = document.getElementById("previewWrap");
const previewImage = document.getElementById("previewImage");
const roastButton = document.getElementById("roastButton");
const roastLevel = document.getElementById("roastLevel");
const styleGoal = document.getElementById("styleGoal");
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

const levelDescriptions = {
  mother: "Ziet vooral potentie en wil je niet kwetsen.",
  honest: "Zegt gewoon wat werkt en wat niet.",
  hard: "Een scherpe docent met weinig geduld.",
  merciless: "Roast eerst, nuance later.",
  timo: "Alles wat laf, veilig of halfbakken is wordt afgemaakt."
};

imageInput.addEventListener("change", handleImageUpload);
roastButton.addEventListener("click", handleRoast);
roastLevel.addEventListener("change", updateLevelDescription);

updateLevelDescription();

function updateLevelDescription() {
  levelDescription.textContent = levelDescriptions[roastLevel.value] || "";
}

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
    await delay(1200);

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

  fillList(strengthsList, data.strengths);
  fillList(problemsList, data.problems);
  fillList(fixesList, data.fixes);
}

function fillList(element, items) {
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
  const styleFixMap = {
    cinematic: "Maak de belichting directioneler en zorg dat je subject duidelijker loskomt van de achtergrond.",
    commercial: "Maak het cleaner, gecontroleerder en visueel duurder met meer shape in het licht.",
    raw: "Laat het minder netjes voelen en durf dichter op je onderwerp te kruipen.",
    arthouse: "Maak het kader gedurfder en laat negatieve ruimte echt betekenis dragen.",
    intimate: "Ga dichter op je subject zitten en maak de camera-emotie persoonlijker."
  };

  const variants = {
    mother: {
      cinema_score: 6.6,
      brutality_score: 1,
      one_liner_roast:
        "Ahh, er zit echt wel sfeer in hoor. Misschien kan het nog net wat sterker als je onderwerp iets meer aandacht krijgt.",
      strengths: [
        "Er zit al een duidelijk gevoel in het beeld en dat is veel waard.",
        "De exposure lijkt bruikbaar en het shot voelt niet compleet willekeurig.",
        "Je hebt in ieder geval een basis van sfeer neergezet waar je op kunt voortbouwen."
      ],
      problems: [
        "Je onderwerp zou nog iets meer mogen loskomen van de achtergrond.",
        "De compositie voelt nu nog een beetje veilig.",
        "Het licht zou iets meer richting mogen krijgen om het beeld sterker te maken."
      ],
      fixes: [
        "Probeer je onderwerp iets minder centraal te zetten.",
        "Kijk of je de achtergrond een tikje rustiger of donkerder kunt maken.",
        styleFixMap[styleGoal],
        "Durf gerust iets duidelijker te kiezen in camerastandpunt of afstand."
      ],
      final_verdict:
        "Een prima begin met sfeer en potentie. Nog niet helemaal uitgesproken, maar zeker iets waar je verder mee kunt."
    },

    honest: {
      cinema_score: 6.0,
      brutality_score: 4,
      one_liner_roast:
        "Het shot is bruikbaar en leesbaar, maar voelt nog meer geregistreerd dan echt doordacht.",
      strengths: [
        "Het onderwerp is leesbaar en het shot heeft een basis van sfeer.",
        "Exposure en algemene look zijn functioneel genoeg om op door te bouwen.",
        "Er zit een visuele richting in, alleen nog niet uitgesproken genoeg."
      ],
      problems: [
        "De compositie is te veilig en daardoor niet heel memorabel.",
        "Het licht mist richting en shape, waardoor het beeld wat vlak blijft.",
        "De achtergrond helpt het onderwerp nog onvoldoende."
      ],
      fixes: [
        "Maak een duidelijkere keuze in kadrering: dichterbij, lager of grafischer.",
        "Geef het licht meer richting zodat het onderwerp meer vorm krijgt.",
        "Zorg dat je onderwerp meer scheidt van de achtergrond.",
        styleFixMap[styleGoal]
      ],
      final_verdict:
        "Functioneel en niet slecht, maar nog te voorzichtig om echt sterk cinematografisch te voelen."
    },

    hard: {
      cinema_score: 5.8,
      brutality_score: 7,
      one_liner_roast:
        "Dit shot voelt gekozen uit veiligheid, niet uit overtuiging.",
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
    },

    merciless: {
      cinema_score: 5.1,
      brutality_score: 9,
      one_liner_roast:
        "Dit is geen compositie, dit is cameratoezicht met ambitie.",
      strengths: [
        "Het shot is technisch nog net bruikbaar genoeg om niet meteen af te serveren.",
        "Het onderwerp is tenminste herkenbaar, dus volledig stuurloos is het niet.",
        "Er zit ergens een poging tot sfeer in."
      ],
      problems: [
        "Het kader maakt geen harde keuze en blijft hangen in slap middengebied.",
        "Het licht doet bijna niets om het onderwerp echt te shapen of te isoleren.",
        "De achtergrond concurreert eerder met je shot dan dat hij het ondersteunt.",
        "Het frame voelt alsof niemand op set durfde te kiezen voor iets spannenders."
      ],
      fixes: [
        "Ga dichterbij of juist grafischer wijder, maar stop met dit veilige tussenin.",
        "Maak je licht duidelijker: richting, contrast en prioriteit.",
        "Laat de achtergrond ondergeschikt worden aan je onderwerp.",
        styleFixMap[styleGoal]
      ],
      final_verdict:
        "Niet waardeloos, wel besluiteloos. Dit beeld mist lef, hiërarchie en een echte cinematografische keuze."
    },

    timo: {
      cinema_score: 4.7,
      brutality_score: 10,
      one_liner_roast:
        "Je hebt hier technisch een shot gemaakt, maar creatief echt geen reet besloten.",
      strengths: [
        "Het bestand is succesvol geüpload.",
        "Je onderwerp staat in beeld.",
        "Het shot is niet volledig onbruikbaar, alleen visueel veel te braaf."
      ],
      problems: [
        "Alles hangt in dat slappe middengebied waar beelden doodgaan.",
        "De compositie is laf en veel te veilig om echt iets te voelen.",
        "Het licht is zo besluiteloos dat niets in het frame belangrijk wordt.",
        "De achtergrond voegt weinig toe en verraadt vooral gebrek aan controle.",
        "Dit beeld registreert wel iets, maar zegt visueel bijna niks."
      ],
      fixes: [
        "Maak eindelijk een echte keuze in afstand, hoogte en kader.",
        "Shape je licht alsof het onderwerp ertoe doet.",
        "Haal storende of nutteloze achtergrondinformatie weg of duw die visueel terug.",
        styleFixMap[styleGoal]
      ],
      final_verdict:
        "Technisch bruikbaar, creatief halfbakken. Dit shot had veel harder, slimmer en uitgesprokener gekund."
    }
  };

  return variants[roastLevel] || variants.hard;
}

/*
Later vervang je handleRoast() door een echte fetch naar je backend.

Bijvoorbeeld:

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
