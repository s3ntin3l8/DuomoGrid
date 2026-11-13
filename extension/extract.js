/* DuomoGrid — reads the exposé the user already opened. No requests, no crawl. */
(function () {
  function normKey(key) {
    return String(key)
      .toLowerCase()
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function parseCoordinate(raw) {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (raw == null) return null;
    let s = String(raw).trim().replace(/\s/g, "").replace(/°/g, "");
    if (!s) return null;
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Append a house number unless the last token already is that number, or that number plus one letter (12a). */
  function joinStreet(streetName, houseNumber) {
    const name = String(streetName ?? "").replace(/\s+/g, " ").trim();
    const number = String(houseNumber ?? "").trim();
    if (!name) return null;
    if (!number) return name.slice(0, 160);
    const last = (name.split(" ").at(-1) ?? "").toLowerCase();
    const wanted = number.toLowerCase();
    const already = last === wanted || (last.startsWith(wanted) && /^[a-z]$/.test(last.slice(wanted.length)));
    return (already ? name : `${name} ${number}`).slice(0, 160);
  }

  function parseDeNumber(raw) {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (raw == null) return null;
    let s = String(raw).trim();
    if (!s || /anfrage/i.test(s)) return null;
    s = s.replace(/\s/g, "").replace(/€/g, "");
    s = s.replace(/m²|qm|kwh.*$/i, "");
    s = s.replace(/[^0-9,.-]/g, "");
    if (!s || s === "-" || s === "." || s === ",") return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Portal placeholders for "not stated". They must read as missing, never as a street or a condition. */
  const ABSENT = /^(no[_ ]information|keine angabe|n\/a)$/i;

  function unwrap(value) {
    if (value == null) return null;
    if (typeof value === "string") return ABSENT.test(value.trim()) ? null : value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      const parts = value.map(unwrap).filter((part) => part != null && part !== "");
      return parts.length ? parts.join(", ") : null;
    }
    if (typeof value === "object") {
      if ("value" in value) return unwrap(value.value);
      if ("amount" in value) return unwrap(value.amount);
      if ("@value" in value) return unwrap(value["@value"]);
    }
    return null;
  }

  function pick(records, aliases) {
    const wanted = new Set(aliases.map(normKey));
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      for (const [key, value] of Object.entries(record)) {
        if (!wanted.has(normKey(key))) continue;
        const next = unwrap(value);
        if (next != null && next !== "") return next;
      }
    }
    return null;
  }

  function yes(value) {
    const s = String(value ?? "").toLowerCase();
    return value === true || s === "yes" || s === "true" || s === "ja" || s === "1" || s === "y";
  }

  function scriptBlob(doc) {
    let blob = "";
    const scripts = doc.scripts ? Array.from(doc.scripts) : Array.from(doc.querySelectorAll?.("script") ?? []);
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text || text.length > 600000) continue;
      blob += `\n${text}`;
      if (blob.length > 1800000) break;
    }
    return blob;
  }

  /** The balanced `{ … }` text after `name`, or null. Not parsed: IS24 also writes JS literals with `undefined`. */
  function assignedSource(source, name) {
    const idx = source.indexOf(name);
    if (idx < 0) return null;
    const start = source.indexOf("{", idx);
    if (start < 0 || start - idx > 40) return null;
    let depth = 0;
    let inString = false;
    let quote = "";
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) inString = false;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return null;
  }

  function assignedObject(source, name) {
    const text = assignedSource(source, name);
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function regexFields(source) {
    const out = {};
    const quoted = /["']?(obj_[A-Za-z0-9_]+|geo_[A-Za-z0-9_]+)["']?\s*[:=]\s*["']([^"']{0,240})["']/g;
    const numeric = /["']?(obj_[A-Za-z0-9_]+|geo_[A-Za-z0-9_]+)["']?\s*[:=]\s*(-?\d+(?:\.\d+)?)/g;
    let match;
    while ((match = quoted.exec(source))) out[match[1]] = match[2];
    while ((match = numeric.exec(source))) {
      if (out[match[1]] == null) out[match[1]] = match[2];
    }
    return out;
  }

  function walkJson(node, out, depth) {
    if (!node || depth > 7) return;
    if (Array.isArray(node)) {
      for (const item of node) walkJson(item, out, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const keys = Object.keys(node);
    if (keys.length && keys.length < 80) out.push(node);
    if (node.address && typeof node.address === "object") out.push(node.address);
    if (node.offers && typeof node.offers === "object") out.push(node.offers);
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") walkJson(value, out, depth + 1);
    }
  }

  function jsonRecords(doc) {
    const out = [];
    const nodes = doc.querySelectorAll
      ? doc.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]')
      : [];
    for (const script of nodes) {
      try {
        walkJson(JSON.parse(script.textContent || ""), out, 0);
      } catch {
        /* ignore broken blocks */
      }
    }
    return out;
  }

  function ownText(el) {
    let text = "";
    for (const node of el.childNodes || []) {
      if (node.nodeType === 3) text += node.textContent || "";
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function siblingValue(el) {
    const next = el.nextElementSibling;
    if (next) {
      const text = (next.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length < 160) return text;
    }
    const parent = el.parentElement;
    if (!parent) return "";
    const chunks = [];
    for (const child of parent.children || []) {
      if (child === el) continue;
      const text = (child.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text.length < 160) chunks.push(text);
    }
    return chunks[0] || "";
  }

  function domRecord(doc) {
    const record = {};
    if (!doc.querySelectorAll) return record;
    const labels = [
      [/kaufpreis/, "priceEur"],
      [/kaltmiete/, "coldRentEur"],
      [/wohnflaeche|wohnflache/, "livingAreaM2"],
      [/grundstuecksflaeche|grundstucksflache|grundstuck/, "plotAreaM2"],
      [/^zimmer$/, "rooms"],
      [/baujahr/, "yearBuilt"],
      [/modernisierung|sanierung/, "yearRefurbished"],
      [/energieeffizienzklasse/, "energyClass"],
      [/endenergie/, "energyKwh"],
      [/hausgeld/, "hausgeldEur"],
      [/kauferprovision|provision|maklerprovision|courtage/, "provisionText"],
      [/energietraeger|befeuerung|heizungsart|^heizung$/, "heating"],
      [/objektzustand|^zustand$/, "condition"],
      [/^etage$/, "floor"],
      [/^badezimmer$/, "bathrooms"],
      [/^schlafzimmer$/, "bedrooms"],
      [/garagestellplatzkaufpreis|stellplatzkaufpreis|garagekaufpreis/, "parkingPriceEur"],
      [/^(garage|stellplatz|garagestellplatz|garageparkplatz|tiefgarage|parkplatz)$/, "parkingText"],
      [/bezugsfrei/, "availableFrom"],
      [/heizungsart/, "heatingSystem"],
      [/energietraeger|befeuerung/, "energySource"],
    ];
    for (const el of doc.querySelectorAll("body *")) {
      const own = ownText(el);
      if (!own || own.length > 42) continue;
      const key = normKey(own);
      for (const [pattern, field] of labels) {
        if (record[field] || !pattern.test(key)) continue;
        const value = siblingValue(el);
        if (value) record[field] = value;
      }
    }
    return record;
  }


  /** Index of the closing quote of the JSON/JS string literal that opens at `from`, or -1. */
  function literalEnd(source, from) {
    let escaped = false;
    for (let i = from + 1; i < source.length; i += 1) {
      const char = source[i];
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') return i;
    }
    return -1;
  }

  function at(node, path) {
    let current = node;
    for (const key of path) {
      if (current == null || typeof current !== "object") return undefined;
      current = current[key];
    }
    return current;
  }

  function round5(n) {
    return Math.round(n * 1e5) / 1e5;
  }

  /** Area-weighted centre of a ring of [lng, lat] pairs. Falls back to the mean of the vertices. */
  function ringCentre(ring) {
    const pts = (ring || []).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length === 0) return null;
    const [ox, oy] = pts[0];
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < pts.length; i += 1) {
      const [x0, y0] = [pts[i][0] - ox, pts[i][1] - oy];
      const [x1, y1] = [pts[(i + 1) % pts.length][0] - ox, pts[(i + 1) % pts.length][1] - oy];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (Math.abs(area) < 1e-14) {
      const mean = pts.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]);
      return { longitude: round5(mean[0] / pts.length), latitude: round5(mean[1] / pts.length) };
    }
    return { longitude: round5(ox + cx / (3 * area)), latitude: round5(oy + cy / (3 * area)) };
  }

  /** GeoJSON geometry to one point. A Point is the place itself; a polygon is only the area it is in. */
  function geometryPoint(geometry) {
    if (!geometry || typeof geometry !== "object") return null;
    const coordinates = geometry.coordinates;
    if (geometry.type === "Point" && Array.isArray(coordinates)) {
      return { longitude: round5(coordinates[0]), latitude: round5(coordinates[1]), point: true };
    }
    const ring = geometry.type === "MultiPolygon" ? at(coordinates, [0, 0]) : geometry.type === "Polygon" ? at(coordinates, [0]) : null;
    const centre = ringCentre(ring);
    return centre ? { ...centre, point: false } : null;
  }

  /** Immowelt ships the whole exposé as a JSON string inside JSON.parse("…") in a script tag. */
  function immoweltClassified(doc) {
    const scripts = doc.querySelectorAll ? Array.from(doc.querySelectorAll("script")) : [];
    const marker = /__UFRN_LIFECYCLE_SERVERREQUEST__"\]\s*=\s*JSON\.parse\(\s*(?=")/;
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = marker.exec(text);
      if (!match) continue;
      const open = match.index + match[0].length;
      const close = literalEnd(text, open);
      if (close < 0) continue;
      try {
        const root = JSON.parse(JSON.parse(text.slice(open, close + 1)));
        for (const value of Object.values(root || {})) {
          if (value && typeof value === "object" && value.data && value.data.classified) return value.data.classified;
        }
      } catch {
        /* a changed page layout is not an error, the other collectors still run */
      }
    }
    return null;
  }

  function immoweltRecord(c) {
    const record = {};
    const sale = String(at(c, ["rawData", "distributionType"]) ?? "").toUpperCase() !== "RENT";
    const track = at(c, ["tracking", "av_items", 0]) || {};
    const cfg = at(c, ["advertising", "tracking_config"]) || {};
    const sections = c.sections || {};
    const amount = (value) => {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const price = amount(track.price) ?? amount(at(sections, ["mortgage", "price"]));
    if (sale) record.purchasePrice = price;
    else record.baseRent = price;
    record.livingSpace = amount(cfg.Wohnflaeche);
    record.noRooms = amount(cfg.Raeume);
    record.immotype = at(c, ["rawData", "propertyType"]);
    record.marketingType = at(c, ["rawData", "distributionType"]);
    record.externalId = at(c, ["metadata", "legacyId"]);
    record.listingTitle = at(sections, ["description", "headline"]) ?? at(sections, ["mainDescription", "headline"]);
    record.description = at(sections, ["mainDescription", "description"]) ?? at(sections, ["description", "description"]);
    const address = at(sections, ["location", "address"]) || {};
    record.city = address.city;
    record.postalCode = address.zipCode;
    record.district = address.district;
    record.state = cfg.Bundesland;
    const geometry = geometryPoint(at(sections, ["location", "geometry"]));
    if (geometry) {
      record.latitude = geometry.latitude;
      record.longitude = geometry.longitude;
      record.locationPrecision = geometry.point && at(sections, ["location", "isAddressPublished"]) === true ? "exact" : "approximate";
    }
    record.commissionText = at(sections, ["price", "base", "commissionFee", "value"]);
    record.condition = track.building_state;
    const energy = at(sections, ["energy"]) || {};
    for (const feature of energy.features || []) {
      if (feature.type === "yearOfConstruction") record.yearConstructed = feature.value;
      if (feature.type === "heatingSystem") record.heating = feature.value;
    }
    const cert = at(energy, ["certificates", 0]) || {};
    const scale = at(cert, ["scales", 0]) || {};
    record.energyEfficiencyClass = at(scale, ["efficiencyClass", "rating"]);
    record.thermalCharacteristic = at(scale, ["values", 0, "value"]);
    for (const feature of cert.features || []) {
      if (feature.type === "basedOn") record.buildingEnergyRatingType = feature.value;
    }
    const elements = [];
    const parking = [];
    let bathrooms = null;
    for (const category of at(sections, ["features", "details", "categories"]) || []) {
      for (const element of category.elements || []) {
        if (element.icon === "floors") record.floor = element.value;
        else if (element.value) elements.push(String(element.value));
        if (element.icon === "parking-lots" && element.value) parking.push(String(element.value));
        const bath = /^(\d{1,2})\s*badezimmer/i.exec(String(element.value ?? ""));
        if (bath) bathrooms = Number(bath[1]);
      }
    }
    if (elements.length) record.features = elements.join(" · ");
    // The stock line ("1 Stellplatz") carries the count; the feature carries the kind.
    const note = at(sections, ["price", "note"]);
    if (/stellpl|garage|carport|parkpl/i.test(String(note ?? ""))) parking.push(String(note));
    if (parking.length) record.parkingText = parking.join(", ");
    for (const feature of energy.features || []) {
      if (feature.type === "energySource") record.energySource = feature.value;
      if (feature.type === "heatingSystem") record.heatingSystem = feature.value;
    }
    const extended = String(at(sections, ["extendedInfoDescription", "description"]) ?? "");
    if (bathrooms == null) {
      const found = /Anzahl der Badezimmer:\s*(\d{1,2})/i.exec(extended);
      if (found) bathrooms = Number(found[1]);
    }
    record.bathrooms = bathrooms;
    record.bedrooms = amount(cfg.Schlafzimmer);
    record.descriptionObject = at(sections, ["mainDescription", "description"]);
    record.descriptionLocation = at(sections, ["areaDescription", "description"]);
    record.descriptionOther = extended || null;
    record.descriptionFurnishing = at(sections, ["features", "details", "additionalText"]);
    record.listedAt = at(c, ["metadata", "creationDate"]);
    record.portalPreviousPriceEur = at(sections, ["hardFacts", "price", "previousPrice"]);
    const market = at(sections, ["priceComparison", "data"]) || {};
    record.portalMarketEurPerM2 = market.value;
    record.portalMarketLowEurPerM2 = market.low;
    record.portalMarketHighEurPerM2 = market.high;
    return record;
  }

  /** Label and value pairs as Immowelt shows them. Category titles label the feature lines. */
  function immoweltDetails(c) {
    const pairs = [];
    const sections = c.sections || {};
    for (const category of at(sections, ["features", "details", "categories"]) || []) {
      for (const element of category.elements || []) {
        if (category.title && element.value) pairs.push({ label: cleanText(category.title), value: cleanText(element.value) });
      }
    }
    for (const feature of at(sections, ["energy", "features"]) || []) {
      if (feature.label && feature.value) pairs.push({ label: cleanText(feature.label), value: cleanText(feature.value) });
    }
    const fee = at(sections, ["price", "base", "commissionFee"]);
    if (fee && fee.value) pairs.push({ label: cleanText(at(fee, ["label"]) || "Provision"), value: cleanText(fee.value) });
    return pairs;
  }

  const IMAGES_MAX = 40;
  /** Same hosts as IMAGE_HOSTS in src/domain/types.ts. The server is the gate; this keeps a stray URL out of the payload. */
  const IMAGE_HOSTS = ["pictures.immobilienscout24.de", "mms.immowelt.de"];

  /** Same picture, different size variant: key on the id in the path when there is one. */
  function imageKey(url) {
    const found = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url);
    return found ? found[1].toLowerCase() : url;
  }

  function addImage(list, seen, url, caption, kind) {
    const href = typeof url === "string" ? url.trim() : "";
    if (!/^https:\/\//.test(href) || list.length >= IMAGES_MAX) return;
    try {
      if (!IMAGE_HOSTS.includes(new URL(href).hostname)) return;
    } catch {
      return;
    }
    const key = imageKey(href);
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ url: href, caption: cleanText(caption).slice(0, 120) || null, kind });
  }

  function immoweltImages(c) {
    const list = [];
    const seen = new Set();
    const medias = at(c, ["domains", "medias"]) || {};
    for (const image of medias.images || []) addImage(list, seen, image.url, image.description, "photo");
    for (const plan of medias.floorplans || []) addImage(list, seen, plan.url, plan.description, "floorplan");
    return list;
  }

  /** The gallery marks plans as FLOORPLAN. The documents list repeats them, so it only fills a gap. */
  function is24Images(blob) {
    const list = [];
    const seen = new Set();
    const gallery = assignedObject(blob, "galleryData");
    for (const image of (gallery && gallery.images) || []) {
      const kind = image.type === "FLOORPLAN" ? "floorplan" : "photo";
      if (image.type && image.type !== "PICTURE" && image.type !== "FLOORPLAN") continue;
      addImage(list, seen, image.fullSizePictureUrl || image.galleryPictureUrl, image.caption, kind);
    }
    const links = assignedObject(blob, '"linksAndDocuments"');
    for (const item of (links && links.items) || []) {
      if (item.floorPlan === true) addImage(list, seen, item.url, item.caption, "floorplan");
    }
    return list;
  }

  /** The dt/dd pairs ImmoScout24 renders. Soft hyphens and long explanations are dropped. */
  function dlPairs(doc) {
    const pairs = [];
    if (!doc.querySelectorAll) return pairs;
    for (const dt of doc.querySelectorAll("dt")) {
      const dd = dt.nextElementSibling;
      if (!dd || String(dd.tagName).toLowerCase() !== "dd") continue;
      // ImmoScout24 tags every exposé fact with an is24qa- class. Other lists on the page (agent, cookies) have none.
      if (!String(dt.className || "").includes("is24qa-")) continue;
      const label = cleanText(dt.textContent);
      const value = cleanText(dd.textContent);
      if (!label || !value || label.length > 80 || value.length > 200) continue;
      pairs.push({ label, value });
      if (pairs.length >= 40) break;
    }
    return pairs;
  }

  /** IS24 keeps the point, the town and the gallery in JS literals next to keyValues. Read by path: bbox corners share the key names. */
  function is24Record(blob) {
    const record = {};
    const map = assignedObject(blob, '"exposeMap"');
    const location = map && map.location;
    if (location && location.coordinateAvailable !== false) {
      const latitude = parseCoordinate(location.latitude);
      const longitude = parseCoordinate(location.longitude);
      if (latitude != null && longitude != null) {
        record.latitude = latitude;
        record.longitude = longitude;
        record.locationPrecision = location.showFullAddress === true ? "exact" : "approximate";
      }
    }
    // `locationAddress: null` must not make the scan pick up whatever object comes next.
    const addressAt = blob.indexOf("locationAddress");
    const address = addressAt >= 0 && /^locationAddress"?\s*:\s*\{/.test(blob.slice(addressAt, addressAt + 40))
      ? assignedSource(blob, "locationAddress")
      : null;
    if (address) {
      const text = (name) => {
        const match = address.match(new RegExp(`\\b${name}:\\s*"([^"]{0,120})"`));
        return match ? match[1] : null;
      };
      record.city = text("city");
      record.street = text("street");
      record.houseNumber = text("houseNumber");
    }
    const content = assignedObject(blob, '"exposeContent"');
    if (content) {
      if (content.objectDescription) record.descriptionObject = content.objectDescription;
      if (content.furnishingDescription) record.descriptionFurnishing = content.furnishingDescription;
      if (content.locationDescription) record.descriptionLocation = content.locationDescription;
      if (content.otherDescription) record.descriptionOther = content.otherDescription;
    }
    return record;
  }

  function detect(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "");
    if (host === "immobilienscout24.de" || host.endsWith(".immobilienscout24.de")) {
      const match = url.pathname.match(/\/expose\/(\d+)/);
      if (!match) return null;
      return { source: "immobilienscout24", externalId: match[1] };
    }
    if (host === "immowelt.de" || host.endsWith(".immowelt.de")) {
      if (!/\/expose\//.test(url.pathname)) return null;
      const parts = url.pathname.split("/").filter(Boolean);
      return { source: "immowelt", externalId: parts[parts.length - 1] || null };
    }
    return null;
  }

  function parseProvision(text, hasCourtage) {
    const flag = String(hasCourtage ?? "").toLowerCase();
    if (flag === "no" || flag === "false" || flag === "nein") {
      return { percent: 0, text: text ? String(text) : "provisionsfrei" };
    }
    const raw = text == null ? "" : String(text).replace(/\s+/g, " ").trim();
    if (/provisionsfrei|courtagefrei|keine provision|ohne makler/i.test(raw)) return { percent: 0, text: raw };
    const match = raw.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
    if (!match) return { percent: null, text: raw || null };
    let percent = Number(match[1].replace(",", "."));
    if (/zzgl\.?\s*mwst/i.test(raw)) percent = Math.round(percent * 1.19 * 100) / 100;
    if (percent > 4.5 && /50\s*%|haelftig|hälftig|je haelfte|je hälfte/i.test(raw)) {
      percent = Math.round((percent / 2) * 100) / 100;
    }
    return { percent, text: raw };
  }

  function energyClass(value) {
    if (value == null) return null;
    const text = String(value).toUpperCase().replaceAll(" ", "").replace("A_PLUS", "A+").replace("APLUS", "A+");
    const match = text.match(/A\+|A|B|C|D|E|F|G|H/);
    return match ? match[0] : null;
  }

  function energyCert(value) {
    const text = String(value ?? "").toLowerCase();
    if (!text) return null;
    if (text.includes("bedarf") || text.includes("required") || text.includes("demand")) return "bedarf";
    if (text.includes("verbrauch") || text.includes("consum")) return "verbrauch";
    return null;
  }

  function heatingLabel(firing, heatingType, freeText) {
    if (freeText && /[a-zäöü]/i.test(String(freeText)) && !/^obj_/.test(String(freeText))) {
      const text = String(freeText).trim();
      if (text && !/^[a-z0-9_]+$/.test(text)) return text.slice(0, 120);
    }
    const blob = `${firing ?? ""} ${heatingType ?? ""}`.toLowerCase();
    const fuel = blob.includes("heat_pump") || blob.includes("heatpump") || blob.includes("waermepumpe")
      ? "Wärmepumpe"
      : blob.includes("district") || blob.includes("fern")
        ? "Fernwärme"
        : blob.includes("oil") || blob.includes("oel") || blob.includes("öl")
          ? "Öl"
          : blob.includes("pellet") || blob.includes("wood") || blob.includes("holz")
            ? "Holz"
            : blob.includes("electric") || blob.includes("strom") || blob.includes("night")
              ? "Strom"
              : blob.includes("gas")
                ? "Gas"
                : "";
    const system = blob.includes("night")
      ? "Nachtspeicher"
      : blob.includes("floor")
        ? "Fußbodenheizung"
        : blob.includes("central") || blob.includes("zentral")
          ? "Zentralheizung"
          : "";
    if (fuel === "Strom" && system === "Nachtspeicher") return "Nachtspeicher";
    return [fuel, system].filter(Boolean).join("-") || (freeText ? String(freeText).slice(0, 120) : null);
  }

  function conditionLabel(value) {
    const text = String(value ?? "").toLowerCase();
    if (!text) return null;
    const map = [
      ["mint", "Erstbezug"],
      ["first_time", "Erstbezug"],
      ["fully_renovated", "Vollsaniert"],
      ["refurbished", "Refurbished"],
      ["modernized", "Modernized"],
      ["well_kept", "Well kept"],
      ["need_of_renovation", "Needs renovation"],
      ["ripe_for_demolition", "Ready for demolition"],
    ];
    for (const [needle, label] of map) {
      if (text.includes(needle)) return label;
    }
    if (/^[a-z0-9_]+$/.test(text)) return text.replaceAll("_", " ");
    return String(value).slice(0, 80);
  }

  function cleanText(value) {
    return String(value ?? "").replace(/\u00ad/g, "").replace(/\s+/g, " ").trim();
  }

  /** Same fuel mapping as `energySourceOf` in src/domain/ingest.ts. Change them together. */
  function energySourceOf(value) {
    const raw = cleanText(value);
    if (!raw || ABSENT.test(raw)) return null;
    const text = raw.toLowerCase();
    if (text.includes("pellet")) return "Pellets";
    if (/holz|wood|hackschnitzel/.test(text)) return "Holz";
    if (/w(ä|ae|a)rmepumpe|heat.?pump/.test(text)) return "Wärmepumpe";
    if (/erdw(ä|ae|a)rme|geotherm/.test(text)) return "Erdwärme";
    if (/fernw|fern-|district/.test(text)) return "Fernwärme";
    if (/(^|[^a-zäöü])(öl|oel|oil)([^a-zäöü]|$)|heiz(ö|oe)l/.test(text)) return "Öl";
    if (text.includes("gas")) return "Gas";
    if (/strom|electric|nachtspeicher|night/.test(text)) return "Strom";
    if (text.includes("solar")) return "Solar";
    return raw.slice(0, 60);
  }

  /** The installation, not the fuel. IS24 keys are snake_case English, Immowelt text is already German. */
  function heatingSystemOf(value) {
    const raw = cleanText(value);
    if (!raw || ABSENT.test(raw)) return null;
    const text = raw.toLowerCase();
    if (text.includes("self_contained") || text.includes("etagen")) return "Etagenheizung";
    if (text.includes("central") || text.includes("zentral")) return "Zentralheizung";
    if (text.includes("floor") || text.includes("fu\u00dfboden") || text.includes("fussboden")) return "Fußbodenheizung";
    if (text.includes("stove") || text.includes("ofen")) return "Ofenheizung";
    if (text.includes("district") || text.includes("fern")) return "Fernwärme";
    if (/^[a-z0-9_]+$/.test(text)) return null;
    return raw.slice(0, 80);
  }

  /** "2 Stellplätze", "Außen-Stellplatz", "Tiefgarage" to a count and a type. Neither is guessed. */
  function parkingFrom(value) {
    const text = cleanText(value).toLowerCase();
    if (!text) return { spaces: null, type: null };
    const counted = text.match(/(\d{1,2})\s*(?:x\s*)?[a-zäöüß-]*?(?:stellpl|garage|carport|parkpl)/);
    const spaces = counted ? Number(counted[1]) : null;
    let type = null;
    if (/tiefgarage|underground/.test(text)) type = "underground";
    else if (text.includes("carport")) type = "carport";
    else if (text.includes("garage")) type = "garage";
    else if (/au(ß|ss)en|freiplatz|outdoor|stellplatz|stellpl(ä|ae)tze|parkplatz/.test(text)) type = "outdoor";
    return { spaces: spaces != null && spaces > 0 ? spaces : null, type };
  }

  function wholeNumber(value, max) {
    const n = parseDeNumber(value);
    return n != null && Number.isInteger(n) && n > 0 && n <= max ? n : null;
  }

  function positive(value) {
    const n = parseDeNumber(value);
    return n != null && n > 0 ? n : null;
  }

  function buildListing(records, page) {
    const detected = detect(page.href);
    if (!detected) {
      return { ok: false, reason: "Open a single listing on ImmoScout24 or Immowelt, not a results page." };
    }
    const price = parseDeNumber(pick(records, ["objpurchaseprice", "purchaseprice", "kaufpreis", "buyprice"]));
    const coldRent = parseDeNumber(pick(records, ["objbaserent", "baserent", "kaltmiete", "coldrent", "coldrenteur"]));
    const living = parseDeNumber(pick(records, ["objlivingspace", "livingspace", "livingarea", "wohnflaeche", "floorsize", "livingaream2"]));
    const plot = parseDeNumber(pick(records, ["objplotarea", "objlotarea", "plotarea", "lotarea", "grundstuecksflaeche", "plotaream2"]));
    const rooms = parseDeNumber(pick(records, ["objnorooms", "norooms", "numberofrooms", "rooms", "zimmer"]));
    const immotype = pick(records, ["objimmotype", "immotype", "estatetype", "propertytype"]);
    const marketing = pick(records, ["objmarketingtype", "marketingtype", "listingkind"]);
    const blob = `${immotype ?? ""} ${marketing ?? ""}`.toLowerCase();
    let listingKind = "sale";
    if ((blob.includes("miete") || blob.includes("rent")) && !blob.includes("kauf") && !blob.includes("purchase")) {
      listingKind = "rent";
    }
    if (blob.includes("kauf") || blob.includes("purchase") || blob.includes("buy")) listingKind = "sale";
    if (price == null && coldRent != null && listingKind !== "sale") listingKind = "rent";
    if (price != null) listingKind = "sale";
    let propertyType = "other";
    if (blob.includes("wohn") || blob.includes("apartment")) propertyType = "apartment";
    else if (blob.includes("zinshaus") || blob.includes("multi")) propertyType = "multi";
    else if (blob.includes("grund") || blob.includes("plot") || /\bland\b/.test(blob)) propertyType = "land";
    else if (blob.includes("haus") || blob.includes("house")) propertyType = "house";
    if (propertyType === "other") {
      if (plot != null && plot >= 150) propertyType = "house";
      else if (living != null) propertyType = "apartment";
    }
    const firing = pick(records, ["objfiringtypes", "firingtypes"]);
    const heatingType = pick(records, ["objheatingtype", "heatingtype", "heizungsart"]);
    const heatingFree = pick(records, ["heating", "heizung", "energietraeger"]);
    // obj_courtage is a bare y/n flag on the current IS24 layout and could be text on an older one.
    const courtageRaw = pick(records, ["objcourtage"]);
    const courtageIsFlag = /^(y|n|yes|no|ja|nein|true|false)$/i.test(String(courtageRaw ?? "").trim());
    const provision = parseProvision(
      pick(records, ["courtage", "provisiontext", "commissiontext", "kauferprovision", "maklerprovision"]) ?? (courtageIsFlag ? null : courtageRaw),
      pick(records, ["objhascourtage", "hascourtage"]) ?? (courtageIsFlag ? courtageRaw : null),
    );
    const service = parseDeNumber(pick(records, ["objservicecharge", "servicecharge"]));
    const hausgeld = parseDeNumber(pick(records, ["hausgeld", "hausgeldeur"])) ?? (listingKind === "sale" ? service : null);
    const floor = pick(records, ["objfloor", "floor", "etage"]);
    const floors = pick(records, ["objnumberoffloors", "numberoffloors"]);
    const floorText = floor ? (floors ? `${floor} von ${floors}` : String(floor)) : null;
    const longText = (value) => {
      const text = String(value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      return text ? text.slice(0, 6000) : null;
    };
    const descriptionParts = {
      // Only the collected description. The meta description is a teaser and must not stand in for the text.
      object: longText(pick(records, ["descriptionobject", "objdescription"])),
      furnishing: longText(pick(records, ["descriptionfurnishing"])),
      location: longText(pick(records, ["descriptionlocation"])),
      other: longText(pick(records, ["descriptionother"])),
    };
    const hasDescription = Object.values(descriptionParts).some((part) => part != null);
    // The collected description comes first; the meta description or page text only fills a gap.
    const description = String(descriptionParts.object ?? pick(records, ["objdescription", "description", "snippet"]) ?? page.text ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const parking = parkingFrom(pick(records, ["parkingtext"]));
    const heatingSystem = heatingSystemOf(pick(records, ["heatingsystem"])) ?? heatingSystemOf(heatingType);
    const energySource = energySourceOf(pick(records, ["energysource"]) ?? firing);
    const detailPairs = Array.isArray(page.details) ? page.details.slice(0, 40) : [];
    const imageList = Array.isArray(page.images) ? page.images.slice(0, IMAGES_MAX) : [];
    const leasehold = yes(pick(records, ["objleasehold", "leasehold", "erbpacht"])) || /\b(erbpacht|erbbaurecht)\b/i.test(description);
    const monument = yes(pick(records, ["objlisted", "listed", "denkmal", "monument"])) || /denkmalschutz/i.test(description);
    const rentedOut = yes(pick(records, ["objrented", "rented", "vermietet"])) || /(?<!nicht\s)\bvermietet\b/i.test(description);
    const features = [];
    const featureMap = [
      ["objbalcony", "Balcony"],
      ["objgarden", "Garden"],
      ["objcellar", "Cellar"],
      ["objlift", "Lift"],
      ["objbuiltinkitchen", "Fitted kitchen"],
      ["objbarrierfree", "Step-free"],
    ];
    for (const [alias, label] of featureMap) {
      if (yes(pick(records, [alias]))) features.push(label);
    }
    const extraFeatures = pick(records, ["features"]);
    if (typeof extraFeatures === "string") {
      for (const part of extraFeatures.split(/[,·]/)) {
        const item = part.trim();
        if (item && !features.includes(item)) features.push(item);
      }
    }
    const titleSource = String(pick(records, ["listingtitle"]) ?? "") || page.title || String(pick(records, ["name", "title", "objtitle"]) ?? "");
    const title = titleSource
      .replace(/\s+/g, " ")
      .replace(/\s+bei ImmobilienScout24.*$/i, "")
      .replace(/\s+\|\s+Immowelt.*$/i, "")
      .trim()
      .slice(0, 180) || "Listing";
    let city = String(pick(records, ["objregio2", "addresslocality", "city", "stadt"]) ?? "").trim();
    let district = String(pick(records, ["objregio3", "district"]) ?? "").trim() || null;
    // IS24 puts the Kreis in regio2 for small towns and the town in regio3.
    if ((/kreis(?![a-zäöü])/i.test(city) || /^lkr\b/i.test(city)) && district) {
      city = district;
      district = null;
    }
    if (district && district.toLowerCase() === city.toLowerCase()) district = null;
    const precision = pick(records, ["locationprecision"]) === "approximate" ? "approximate" : "exact";
    const latitude = parseCoordinate(pick(records, ["latitude", "geolat", "objlat", "wgs84latitude"]));
    const longitude = parseCoordinate(pick(records, ["longitude", "geolong", "geolng", "objlong", "objlng", "wgs84longitude"]));
    const hasPoint = latitude != null && longitude != null
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      && !(Math.abs(latitude) < 1e-8 && Math.abs(longitude) < 1e-8);
    const street = joinStreet(
      pick(records, ["streetaddress", "street", "objstreet", "strasse"]),
      pick(records, ["housenumber", "objhousenumber", "streetnumber"]),
    );
    const year = (value) => {
      const n = parseDeNumber(value);
      return n != null && n >= 1600 && n <= 2100 ? Math.round(n) : null;
    };
    return {
      ok: true,
      listing: {
        v: 1,
        source: detected.source,
        sourceUrl: page.href,
        externalId: String(pick(records, ["objscoutid", "scoutid", "externalid"]) ?? detected.externalId ?? "") || null,
        scrapedAt: new Date().toISOString(),
        title,
        priceEur: listingKind === "rent" ? coldRent ?? price : price,
        livingAreaM2: living,
        plotAreaM2: plot,
        rooms,
        city,
        district,
        postalCode: String(pick(records, ["objzipcode", "geoplz", "postalcode", "postcode", "plz"]) ?? "").replace(/\s/g, "") || null,
        state: String(pick(records, ["objregio1", "addressregion", "state", "bundesland"]) ?? "").trim() || null,
        street,
        latitude: hasPoint ? latitude : null,
        longitude: hasPoint ? longitude : null,
        locationPrecision: hasPoint ? precision : null,
        propertyType,
        listingKind,
        yearBuilt: year(pick(records, ["objyearconstructed", "yearconstructed", "yearbuilt", "baujahr", "constructionyear"])),
        yearRefurbished: year(pick(records, ["objlastrefurbishment", "lastrefurbishment", "yearrefurbished"])),
        energyClass: energyClass(pick(records, ["objenergyefficiencyclass", "energyefficiencyclass", "energieeffizienzklasse", "energyclass"])),
        energyKwh: parseDeNumber(pick(records, ["objthermalcharacteristic", "thermalcharacteristic", "endenergieverbrauch", "endenergiebedarf", "energykwh"])),
        energyCert: energyCert(pick(records, ["objbuildingenergyratingtype", "buildingenergyratingtype", "objenergytype", "energycertificatetype", "energycert"])),
        heating: heatingLabel(firing, heatingType, heatingFree),
        hausgeldEur: hausgeld,
        coldRentEur: listingKind === "rent" ? coldRent ?? price : coldRent,
        provisionPercent: provision.percent,
        provisionText: provision.text,
        condition: conditionLabel(pick(records, ["objcondition", "condition", "objektzustand"])),
        floor: floorText,
        features: features.slice(0, 24),
        snippet: description.replace(/\s+/g, " ").trim().slice(0, 500),
        leasehold,
        groundRentEur: parseDeNumber(pick(records, ["objleaseholdpayment", "erbbauzins", "groundrent", "groundrenteur"])),
        monument,
        rentedOut,
        heatingSystem,
        energySource,
        parkingSpaces: parking.spaces,
        parkingType: parking.type,
        parkingPriceEur: positive(pick(records, ["parkingpriceeur"])),
        bathrooms: wholeNumber(pick(records, ["bathrooms"]), 30),
        bedrooms: wholeNumber(pick(records, ["bedrooms"]), 30),
        availableFrom: cleanText(pick(records, ["availablefrom"])).slice(0, 80) || null,
        listedAt: cleanText(pick(records, ["listedat"])) || null,
        portalPreviousPriceEur: positive(pick(records, ["portalpreviouspriceeur"])),
        portalMarketEurPerM2: positive(pick(records, ["portalmarketeurperm2"])),
        portalMarketLowEurPerM2: positive(pick(records, ["portalmarketloweurperm2"])),
        portalMarketHighEurPerM2: positive(pick(records, ["portalmarkethigheurperm2"])),
        // Left out when nothing was found, so a page that failed to load a section never blanks what is stored.
        ...(hasDescription ? { description: descriptionParts } : {}),
        ...(detailPairs.length > 0 ? { details: detailPairs } : {}),
        // Left out when none were found, so a gallery that had not loaded yet never blanks the stored images.
        ...(imageList.length > 0 ? { images: imageList } : {}),
      },
    };
  }

  function pageTitle(doc) {
    const h1 = doc.querySelector?.("h1")?.textContent;
    const og = doc.querySelector?.('meta[property="og:title"]')?.getAttribute("content");
    return (h1 || og || "").replace(/\s+/g, " ").trim();
  }

  function pageText(doc) {
    const main = doc.querySelector?.("main") || doc.body;
    return (main?.innerText || main?.textContent || "").slice(0, 5000);
  }

  function extractListing(doc, href) {
    const detected = detect(href);
    if (!detected) {
      return { ok: false, reason: "Open a single listing on ImmoScout24 or Immowelt, not a results page." };
    }
    const blob = scriptBlob(doc);
    const records = [];
    const classified = immoweltClassified(doc);
    if (classified) records.push(immoweltRecord(classified));
    const explicit = is24Record(blob);
    if (Object.keys(explicit).length) records.push(explicit);
    const keyValues = assignedObject(blob, "keyValues");
    if (keyValues) records.push(keyValues);
    const fields = regexFields(blob);
    if (Object.keys(fields).length) records.push(fields);
    records.push(...jsonRecords(doc));
    const labeled = domRecord(doc);
    if (Object.keys(labeled).length) records.push(labeled);
    const details = classified ? immoweltDetails(classified) : dlPairs(doc);
    const images = classified ? immoweltImages(classified) : is24Images(blob);
    return buildListing(records, { href, title: pageTitle(doc), text: pageText(doc), details, images });
  }

  globalThis.duomoExtract = extractListing;
  globalThis.duomoBuildListing = buildListing;
  globalThis.duomoParseCoordinate = parseCoordinate;
  globalThis.duomoJoinStreet = joinStreet;
})();
