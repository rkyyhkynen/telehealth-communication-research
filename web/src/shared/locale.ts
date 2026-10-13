export type AppLocale = 'en' | 'fi';
const PENDING_LOCALE_STORAGE_KEY = 'callpython.pendingUiLocale';
const STORED_LOCALE_STORAGE_KEY = 'callpython.uiLocale';

const EXACT_TRANSLATIONS: Record<string, string> = {
  'Invalid room URL.': 'Virheellinen URL-osoite.',
  'Missing room configuration.': 'Huoneen asetukset puuttuvat.',
  'Use /room/<room-id> or /avatar/<room-id>.': 'Käytä /room/<room-id> tai /avatar/<room-id>.',
  'Classic Call': 'Videopuhelu',
  'Avatar Patient': 'Virtuaalipotilas',
  'Press and hold Space to speak to the patient.': 'Pidä välilyöntiä painettuna puhuaksesi potilaalle.',
  'Push to Talk': 'Push to Talk',
  'Hold Push to Talk or press Space.': 'Pidä Push to Talk -painiketta tai paina välilyöntiä.',
  'Listening...': 'Kuunnellaan...',
  'Processing patient response...': 'Käsitellään potilaan vastausta...',
  Mute: 'Mykistä',
  Unmute: 'Poista mykistys',
  'Start video call': 'Aloita videopuhelu',
  'Stop video call': 'Lopeta videopuhelu',
  'Processing...': 'Käsitellään...',
  'Processing audio data...': 'Käsitellään äänitietoja...',
  'Analysis processing complete.': 'Analyysin käsittely valmis.',
  'Error processing audio. You can continue the call.': 'Äänen käsittelyssä virhe. Voit jatkaa videopuhelua.',
  'Room UI elements are not ready yet.': 'Huoneen käyttöliittymä ei ole vielä valmis.',
  'Room bootstrap failed.': 'Huoneen käynnistys epäonnistui.',
  'Could not access your camera or microphone. Please check your device permissions.': 'Kameraa tai mikrofonia ei voitu käyttää. Tarkista laitteen käyttöoikeudet.',
  'No audio track available to mute.': 'Mykistettävää ääniraitaa ei ole saatavilla.',
  'AI patient response failed. Check API logs for details.': 'AI-potilaan vastaus epäonnistui. Tarkista API-lokit.',
  'Peer connection is not available.': 'Vertaisyhteys ei ole käytettävissä.',
  'Analysis is still processing. Please wait.': 'Analyysiä käsitellään yhä. Odota hetki.',
  'Call has ended. Rejoin a room to run analysis.': 'Videopuhelu on päättynyt. Liity huoneeseen uudelleen analyysiä varten.',
  'Failed to access microphone for analysis': 'Mikrofonia ei voitu käyttää analyysiä varten',
  'Stop analysis and end call?\n\nThis will end the call now and process your analysis.': 'Lopetetaanko analyysi ja videopuhelu?\n\nVideopuhelu päättyy nyt ja analyysi käsitellään.',
  'No analysis data yet. Start a room call and end analysis to populate this page.': 'Analyysidataa ei vielä ole. Aloita videopuhelu ja päätä analyysi täyttääksesi tämän sivun.',
  'Saved analysis data was invalid and has been cleared. Run a new analysis session.': 'Tallennettu analyysidata oli virheellistä ja poistettiin. Suorita uusi analyysi.',
  'Failed to initialize analysis data.': 'Analyysidatan alustus epäonnistui.',
  'Are you sure you want to leave this page? Any analysis data will be lost.': 'Haluatko varmasti poistua tältä sivulta? Analyysidata menetetään.',
  'Analysis bootstrap failed.': 'Analyysin käynnistys epäonnistui.',
  'Analysis Dashboard': 'Analyysin yhteenveto',
  'Key Insights': 'Keskeiset havainnot',
  'Opening PDF...': 'Avataan PDF...',
  'Export PDF': 'Lataa PDF',
  'Learn & Quiz': 'Opi ja testaa',
  'Eye Contact': 'Katsekontakti',
  Nodding: 'Pään liike',
  'Shoulder Visibility': 'Hartiat',
  'Speaking Time': 'Puheaika',
  Expressions: 'Ilmeet',
  'No call duration yet': 'Ei vielä videopuhelun kestoa',
  'No data': 'Ei tietoja',
  'No gaze data': 'Ei katsetietoa',
  'No nodding data': 'Ei nyökkäystietoa',
  'No shoulder data': 'Ei hartiatietoja',
  'No audio data': 'Ei äänidataa',
  'Most detected: N/A': 'Eniten havaittu: ei tietoja',
  '0 detected expression types': '0 havaittua ilmettä',
  'Camera-facing share': 'Kameraan suuntautunut osuus',
  'Detected during session': 'Havaittu videopuhelun aikana',
  'No nods detected during session': 'Ei nyökkäyksiä videopuhelun aikana',
  'Visible on camera': 'Näkyvissä kamerassa',
  'Of call duration': 'Videopuhelun kestosta',
  'Emotion Distribution': 'Kasvonilmeiden jakauma',
  'No emotion data detected': 'Tunnetietoa ei havaittu',
  'No strong expression detected': 'Voimakasta ilmettä ei havaittu',
  Count: 'Määrä',
  'Expression strength': 'Ilmeen voimakkuus',
  Time: 'Aika',
  High: 'Korkea',
  Medium: 'Keskitaso',
  Low: 'Matala',
  'Facial expressions': 'Kasvonilmeet',
  'Learn more ▾': 'Lue lisää ▾',
  'Your most frequent expressions': 'Yleisimmät ilmeesi',
  'No emotion interpretation available': 'Tunteista ei ole tulkintaa saatavilla',
  'Facial expressions timeline': 'Kasvonilmeiden aikajana',
  'How to read this': 'Näin luet tätä',
  'Speaking time': 'Puheaika',
  'Filler words': 'Täytesanat',
  'No filler words detected': 'Täytesanoja ei löytynyt',
  'Open-ended questions': 'Avoimet kysymykset',
  'No filler words detected in the transcript.': 'Litteroinnista ei löytynyt täytesanoja.',
  Complete: 'Valmis',
  'Complete!': 'Valmis!',
  'Mark as Filler': 'Merkitse täytesanaksi',
  'Select an answer to continue': 'Valitse vastaus jatkaaksesi',
  '✓ Correct!': '✓ Oikein!',
  'Try another option': 'Kokeile toista vaihtoehtoa',
  'Close key insights information': 'Sulje lisätiedot',
  'Key Insights Information': 'Tietoa keskeisistä havainnoista',
  'Eye Contact in Telehealth': 'Katsekontakti etävastaanotolla',
  'Start Quiz': 'Aloita testi',
  '3 questions': '3 kysymystä',
  'Check Answers': 'Tarkista vastaukset',
  'Nodding in Telehealth': 'Nyökkäily etävastaanotolla',
  'Shoulder Visibility in Telehealth': 'Hartioiden näkyvyys etävastaanotolla',
  'Speaking Time in Telehealth': 'Puheaika etävastaanotolla',
  'Facial Expressions in Telehealth': 'Kasvonilmeet etävastaanotolla',
  'In video consultations, looking at the camera generally creates stronger eye-contact cues than looking at the screen.': 'Etävastaanotolla kameraan katsominen luo yleensä vahvemman katsekontaktin vaikutelman kuin näytölle katsominen.',
  '1. In video consultations, where should healthcare providers look to maintain proper eye contact?': '1. Mihin terveydenhuollon ammattilaisen tulisi katsoa etävastaanotolla säilyttääkseen hyvän katsekontaktin?',
  'At the notes located on the desk': 'Pöydällä oleviin muistiinpanoihin',
  "Directly at the camera lens or patient's face on the screen": 'Suoraan kameraan tai potilaan kasvoihin näytöllä',
  'Out the window for a natural look': 'Ikkunasta ulos luonnollisen vaikutelman vuoksi',
  '2. Why is eye contact particularly important in telehealth settings?': '2. Miksi katsekontakti on erityisen tärkeää etävastaanotolla?',
  'It helps with video connection quality': 'Se parantaa videoyhteyden laatua',
  'It helps establish rapport and trust with patients': 'Se auttaa rakentamaan yhteyttä ja luottamusta potilaan kanssa',
  'It makes consultations easier to record': 'Se tekee vastaanottojen tallentamisesta helpompaa',
  '3. What does research suggest about eye contact in telemedicine consultations?': '3. Mitä tutkimus ehdottaa katsekontaktista etälääketieteen vastaanotoilla?',
  'Eye contact should be avoided to focus on notes': 'Katsekontaktia tulisi välttää, jotta voi keskittyä muistiinpanoihin',
  'Natural eye contact patterns work best': 'Luonnollinen katsekontakti toimii parhaiten',
  'Eye contact should be exaggerated compared to in-person visits': 'Katsekontaktia tulisi korostaa enemmän kuin lähivastaanotolla',
  "Nodding is an important non-verbal cue that indicates active listening and agreement. In telehealth settings, deliberate nodding can help establish rapport with patients and show that you're engaged in the conversation.": 'Nyökkäys on tärkeä nonverbaalinen vihje, joka kertoo aktiivisesta kuuntelusta ja myötäilystä. Etävastaanotolla tietoinen nyökkäily voi auttaa luomaan yhteyttä potilaaseen ja osoittaa, että olet mukana keskustelussa.',
  'Maintaining good posture with visible shoulders indicates professionalism and attentiveness. Proper framing in the camera with visible shoulders creates a more engaging presence during video consultations.': 'Hyvä ryhti ja näkyvät hartiat viestivät ammattimaisuutta ja tarkkaavaisuutta. Oikea kuvakulma, jossa hartiat näkyvät, luo vakuuttavamman läsnäolon etävastaanotolla.',
  'The balance between speaking and listening is crucial in effective telehealth communication. Ideally, healthcare providers should aim for a balanced conversation that allows patients sufficient time to express concerns while also providing clear guidance and information.': 'Puheen ja kuuntelun tasapaino on keskeinen osa toimivaa etävastaanottoviestintää. Ihannetilanteessa ammattilainen pyrkii tasapainoiseen keskusteluun, jossa potilaalla on riittävästi aikaa tuoda huolia esiin ja samalla saa selkeää ohjausta sekä tietoa.',
  'Research suggests that patient-centered communication, where the provider does not dominate the conversation, leads to better patient satisfaction and outcomes.': 'Tutkimusten mukaan potilaslähtöinen viestintä, jossa ammattilainen ei hallitse keskustelua liikaa, parantaa potilastyytyväisyyttä ja hoitotuloksia.',
  'Using varied facial expressions in telehealth shows active participation in the conversation. Computer-mediated communication filters some of the nonverbal behaviors that may influence the empathy conveyed in remote consultations. Exaggeration of nonverbal behavior has been identified in telehealth communication research as a potentially useful way to convey empathy to patients.': 'Vaihtelevat kasvonilmeet etävastaanotolla osoittavat aktiivista osallistumista keskusteluun. Tietokonevälitteinen viestintä suodattaa osan nonverbaalisesta käyttäytymisestä, joka voi vaikuttaa empatian välittymiseen etävastaanotolla. Nonverbaalisten vihjeiden korostaminen on tutkimuksissa tunnistettu mahdollisesti hyödylliseksi tavaksi välittää empatiaa potilaalle.',
  Sources: 'Lähteet',
  'No gaze direction data detected': 'Katseen suuntatietoa ei havaittu',
  'No head direction data detected': 'Pään suuntatietoa ei havaittu',
  Center: 'Keskellä',
  Left: 'Vasen',
  Right: 'Oikea',
  Up: 'Ylös',
  Down: 'Alas',
  Forward: 'Eteen',
  'Gaze Direction': 'Katseen suunta',
  'Head Pose': 'Pään asento',
  'Time (mm:ss)': 'Aika (mm:ss)',
  'Previous page': 'Edellinen sivu',
  'Next page': 'Seuraava sivu',
  Timeline: 'Aikajana',
  'Heat grid': 'Lämpökartta',
  'What this means': 'Mitä tämä tarkoittaa',
  'Shoulders visible': 'Hartiat näkyvissä',
  'Nodding events': 'Nyökkäykset',
  'Shaking events': 'Pudistukset',
  Relaxed: 'Rento',
  Raised: 'Koholla',
  Lowered: 'Alhaalla',
  'No brow movement data detected': 'Kulmaliiketietoa ei havaittu',
  'Gaze direction': 'Katseen suunta',
  'Head direction': 'Pään suunta',
  'Transcript Analysis': 'Litteroinnin analyysi',
  'Interactive transcript': 'Interaktiivinen litterointi',
  'Speech markers': 'Puheen merkinnät',
  'No shoulder interpretation available': 'Hartioista ei ole tulkintaa saatavilla',
  'Nodding & Shaking': 'Nyökkäily ja pään pudistelu',
  'What this suggests': 'Mitä tämä kertoo',
  'No nodding interpretation available': 'Nyökkäilystä ei ole tulkintaa saatavilla',
  'Brow movement': 'Kulmien liike',
  'No brow interpretation available': 'Kulmakarvoista ei ole tulkintaa saatavilla',
  'Waiting for AI analysis...': 'Odotetaan AI-analyysia...',
  'No data available for AI analysis.': 'AI-analyysia varten ei ole dataa.',
  'Requesting AI interpretation...': 'Pyydetään AI-tulkintaa...',
  'LLM analysis unavailable.': 'AI-analyysi ei ole saatavilla.',
  'No response received.': 'Vastausta ei saatu.',
  'Chat request failed.': 'Chat-kysely epäonnistui.',
  'Unknown error': 'Tuntematon virhe',
  'AI communication analysis': 'Tekoälyn viestinnän analyysi',
  Recommendations: 'Suositukset',
  'No recommendations generated.': 'Suosituksia ei luotu.',
  'Ask follow up questions from the analysis': 'Kysy analyysista jatkokysymyksiä',
  'Thinking...': 'Ajattelen...',
  'Ask about your performance...': 'Kysy suoriutumisestasi...',
  'No analysis provided.': 'Analyysia ei ole saatavilla.',
  Send: 'Lähetä',
  'You maintained neutral expression': 'Pidit ilmeen neutraalina',
  'You were smiling': 'Hymyilit',
  'Your lip corners were pulled down': 'Suupielet olivat alaspäin',
  'Your brows were lowered and drawn together': 'Kulmat olivat alhaalla ja vetäytyneet yhteen',
  'Your eyes were widened and brows raised': 'Silmät olivat avautuneet ja kulmat koholla',
  'Your eyes were widened and mouth slightly open': 'Silmät olivat avautuneet ja suu hieman auki',
  'Your nose was wrinkled or upper lip raised': 'Nenä oli rypyssä tai ylähuuli koholla',
  'This timeline shows detected facial expressions over time. Variations are normal and expected.': 'Aikajana näyttää havaitut kasvonilmeet ajan kuluessa. Vaihtelu on normaalia ja odotettua.',
  'Looking away or down can be natural (e.g. taking notes)': 'Katseen suunta pois tai alas voi olla luonnollista (esim. muistiinpanoja tehdessä).',
  'Solid blue blocks = a higher concentration of center-gaze periods': 'Yhtenäiset siniset alueet = enemmän keskikatseen jaksoja.',
  'Solid blue blocks = a higher concentration of forward head-pose periods': 'Yhtenäiset siniset alueet = enemmän eteenpäin suuntautuneen pään asennon jaksoja.',
  'Shoulders were visible on camera most of the time': 'Hartiat näkyivät kamerassa suurimman osan ajasta',
  'Shoulders were visible on camera about half or more of the time': 'Hartiat näkyivät kamerassa noin puolet ajasta tai enemmän',
  'Shoulders were visible on camera less than half of the time': 'Hartiat näkyivät kamerassa alle puolet ajasta',
  Note: 'Huomio',
  'Showing your shoulders helps convey more complete body language': 'Hartioiden näkyminen välittää kokonaisvaltaisempaa kehonkieltä',
  'These events were identified from head movement analysis': 'Nämä tapahtumat tunnistettiin pään liikkeen analyysista',
  'Events were identified from head movement analysis': 'Tapahtumat tunnistettiin pään liikkeen analyysista',
  'No nodding or shaking detected': 'Nyökkäilyä tai pään pudistelua ei havaittu',
  'No nodding or shaking events were detected during this session': 'Tässä istunnossa ei havaittu nyökkäilyä tai pään pudistelua',
  'Brows were in a neutral position': 'Kulmakarvat olivat neutraalissa asennossa',
  'Brow movement was detected': 'Kulmakarvojen liikettä havaittiin',
  'No speech was detected or the audio quality was insufficient for transcription': 'Puhetta ei havaittu tai äänenlaatu ei riittänyt litterointiin',
  'Review the transcript for recognition accuracy before interpreting language patterns': 'Tarkista litteroinnin tunnistustarkkuus ennen kielellisten mallien tulkintaa',
  'Reducing filler words can improve clarity and confidence': 'Täytesanojen vähentäminen voi parantaa selkeyttä ja itsevarmuutta',
  'No open-ended questions were detected': 'Avoimia kysymyksiä ei havaittu'
};

const EMOTION_LABELS: Record<string, string> = {
  happy: 'Iloinen',
  sad: 'Surullinen',
  angry: 'Vihainen',
  surprise: 'Yllättynyt',
  neutral: 'Neutraali',
  fear: 'Pelokas',
  disgust: 'Inho'
};

function translateEmotionToken(token: string): string {
  const normalized = token.toLowerCase();
  return EMOTION_LABELS[normalized] || token;
}

function translateDynamic(text: string): string | null {
  let match = text.match(/^Connection error:\s*(.+)$/);
  if (match) {
    return `Yhteysvirhe: ${match[1]}`;
  }

  match = text.match(/^Error:\s*(.+)$/);
  if (match) {
    const nested = EXACT_TRANSLATIONS[match[1]] || match[1];
    return `Virhe: ${nested}`;
  }

  match = text.match(/^AI analysis failed\.\s*(.+)$/);
  if (match) {
    const nested = EXACT_TRANSLATIONS[match[1]] || match[1];
    return `AI-analyysi epäonnistui. ${nested}`;
  }

  match = text.match(/^Most detected:\s*(.+)$/);
  if (match) {
    return `Eniten havaittu: ${translateEmotionToken(match[1])}`;
  }

  match = text.match(/^(\d+) detected expression (type|types)$/);
  if (match) {
    return `${match[1]} havaittua ilmettä`;
  }

  match = text.match(/^(\d+) nod (event|events)$/);
  if (match) {
    const count = Number(match[1]);
    return `${count} nyökkäystä`;
  }

  match = text.match(/^(\d+)m (\d{2})s call$/);
  if (match) {
    return `${match[1]} min ${match[2]} s`;
  }

  match = text.match(/^(\d+)-second call$/);
  if (match) {
    return `${match[1]} s`;
  }

  match = text.match(/^Found (\d+) of (\d+) filler words - All detected filler words are marked\.$/);
  if (match) {
    return `Löytyi ${match[1]}/${match[2]} täytesanaa - Kaikki havaitut täytesanat on merkitty.`;
  }

  match = text.match(/^Found (\d+) of (\d+) filler words$/);
  if (match) {
    return `Löytyi ${match[1]}/${match[2]} täytesanaa`;
  }

  match = text.match(/^(?:Click on words you think are filler words and mark them|Click the filler words you detect)\. Find all (\d+) filler words in your transcript\.(?: Reducing filler words improves clarity and confidence\.)?$/);
  if (match) {
    return `Klikkaa havaitsemiasi täytesanoja. Etsi litteroinnista kaikki ${match[1]} täytesanaa.`;
  }

  match = text.match(/^(\d+)\/(\d+) correct\.$/);
  if (match) {
    return `${match[1]}/${match[2]} oikein.`;
  }

  match = text.match(/^(\d+)\/(\d+) correct\. Review the information above and try again if needed\.$/);
  if (match) {
    return `${match[1]}/${match[2]} oikein. Katso yllä olevat tiedot ja yritä tarvittaessa uudelleen.`;
  }

  match = text.match(/^Shoulders visible:\s*(\d+)% of the time$/);
  if (match) {
    return `Hartiat näkyivät ${match[1]} % ajasta`;
  }

  match = text.match(/^Shoulders visible \((\d+)%\)$/);
  if (match) {
    return `Hartiat näkyvissä (${match[1]} %)`;
  }

  match = text.match(/^Raised\/Lowered \((\d+)%\)$/);
  if (match) {
    return `Koholla/alhaalla (${match[1]} %)`;
  }

  match = text.match(/^Neutral \((\d+)%\)$/);
  if (match) {
    return `Neutraali (${match[1]} %)`;
  }

  match = text.match(/^Relaxed \((\d+)%\)$/);
  if (match) {
    return `Rento (${match[1]} %)`;
  }

  match = text.match(/^Nodding \((\d+)\) and shaking \((\d+)\) detected$/);
  if (match) {
    return `Nyökkäilyä (${match[1]}) ja pään pudistelua (${match[2]}) havaittiin`;
  }

  match = text.match(/^Nodding detected \((\d+)\)$/);
  if (match) {
    return `Nyökkäilyä havaittiin (${match[1]})`;
  }

  match = text.match(/^Shaking detected \((\d+)\)$/);
  if (match) {
    return `Pään pudistelua havaittiin (${match[1]})`;
  }

  match = text.match(/^You spoke for approximately (\d+)% of the call duration$/);
  if (match) {
    return `Puhuit noin ${match[1]} % videopuhelun ajasta`;
  }

  match = text.match(/^You asked (\d+) open-ended questions during the call$/);
  if (match) {
    return `Esitit videopuhelun aikana ${match[1]} avointa kysymystä`;
  }

  match = text.match(/^([A-Za-z]+)\s*\((\d+)%\)$/);
  if (match) {
    return `${translateEmotionToken(match[1])} (${match[2]} %)`;
  }

  match = text.match(/^You displayed (.+)$/);
  if (match) {
    return `Havaittu ilme: ${translateEmotionToken(match[1])}`;
  }

  return null;
}

export function readStoredLocale(): AppLocale {
  try {
    const pending = window.sessionStorage.getItem(PENDING_LOCALE_STORAGE_KEY);
    if (pending === 'fi' || pending === 'en') {
      window.sessionStorage.removeItem(PENDING_LOCALE_STORAGE_KEY);
      return pending;
    }

    const stored = window.sessionStorage.getItem(STORED_LOCALE_STORAGE_KEY);
    if (stored === 'fi' || stored === 'en') {
      return stored;
    }
  } catch {
    // Ignore storage access failures.
  }

  const langAttr = document.documentElement.lang.toLowerCase();
  return langAttr.startsWith('fi') ? 'fi' : 'en';
}

export function writeStoredLocale(locale: AppLocale): void {
  try {
    window.sessionStorage.setItem(STORED_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage access failures.
  }
}

export function queueLocaleForNextPage(locale: AppLocale): void {
  try {
    window.sessionStorage.setItem(PENDING_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage access failures.
  }
}

export function applyLocaleToDocument(locale: AppLocale): void {
  document.documentElement.lang = locale;
  document.body.dataset.locale = locale;
}

export function nextLocale(locale: AppLocale): AppLocale {
  return locale === 'en' ? 'fi' : 'en';
}

export function getLocaleButtonLabel(locale: AppLocale): string {
  return locale === 'en' ? 'FIN' : 'EN';
}

export function translateUiText(text: string, locale: AppLocale): string {
  if (locale === 'en' || !text) {
    return text;
  }

  const exact = EXACT_TRANSLATIONS[text];
  if (typeof exact === 'string') {
    return exact;
  }

  const dynamic = translateDynamic(text);
  if (dynamic) {
    return dynamic;
  }

  return text;
}
