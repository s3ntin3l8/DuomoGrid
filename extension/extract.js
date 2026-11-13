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

  function unwrap(value) {
    if (value == null) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
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

  function assignedObject(source, name) {
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
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
    return null;
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
    else if (blob.includes("grund") || blob.includes("plot")) propertyType = "land";
    else if (blob.includes("haus") || blob.includes("house")) propertyType = "house";
    if (propertyType === "other") {
      if (plot != null && plot >= 150) propertyType = "house";
      else if (living != null) propertyType = "apartment";
    }
    const firing = pick(records, ["objfiringtypes", "firingtypes"]);
    const heatingType = pick(records, ["objheatingtype", "heatingtype", "heizungsart"]);
    const heatingFree = pick(records, ["heating", "heizung", "energietraeger"]);
    const provision = parseProvision(
      pick(records, ["objcourtage", "courtage", "provisiontext", "kauferprovision", "maklerprovision"]),
      pick(records, ["objhascourtage", "hascourtage"]),
    );
    const service = parseDeNumber(pick(records, ["objservicecharge", "servicecharge"]));
    const hausgeld = parseDeNumber(pick(records, ["hausgeld", "hausgeldeur"])) ?? (listingKind === "sale" ? service : null);
    const floor = pick(records, ["objfloor", "floor", "etage"]);
    const floors = pick(records, ["objnumberoffloors", "numberoffloors"]);
    const floorText = floor ? (floors ? `${floor} von ${floors}` : String(floor)) : null;
    const description = String(pick(records, ["objdescription", "description", "snippet"]) ?? page.text ?? "");
    const leasehold = yes(pick(records, ["objleasehold", "leasehold", "erbpacht"])) || /\b(erbpacht|erbbaurecht)\b/i.test(description);
    const monument = yes(pick(records, ["objlisted", "listed", "denkmal", "monument"])) || /denkmalschutz/i.test(description);
    const rentedOut = yes(pick(records, ["objrented", "rented", "vermietet"])) || /\bvermietet\b/i.test(description);
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
    const titleSource = page.title || String(pick(records, ["name", "title", "objtitle"]) ?? "");
    const title = titleSource
      .replace(/\s+/g, " ")
      .replace(/\s+bei ImmobilienScout24.*$/i, "")
      .replace(/\s+\|\s+Immowelt.*$/i, "")
      .trim()
      .slice(0, 180) || "Listing";
    const latitude = parseCoordinate(pick(records, ["latitude", "geolat", "objlat", "wgs84latitude"]));
    const longitude = parseCoordinate(pick(records, ["longitude", "geolong", "geolng", "objlong", "objlng", "wgs84longitude"]));
    const hasPoint = latitude != null && longitude != null
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      && !(Math.abs(latitude) < 1e-8 && Math.abs(longitude) < 1e-8);
    const streetName = String(pick(records, ["streetaddress", "street", "objstreet", "strasse"]) ?? "").trim();
    const houseNumber = String(pick(records, ["housenumber", "objhousenumber", "streetnumber"]) ?? "").trim();
    const street = (streetName && houseNumber && !streetName.endsWith(houseNumber) ? `${streetName} ${houseNumber}` : streetName).slice(0, 160) || null;
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
        city: String(pick(records, ["objregio2", "addresslocality", "city", "stadt"]) ?? "").trim(),
        district: String(pick(records, ["objregio3", "district"]) ?? "").trim() || null,
        postalCode: String(pick(records, ["objzipcode", "geoplz", "postalcode", "postcode", "plz"]) ?? "").replace(/\s/g, "") || null,
        state: String(pick(records, ["objregio1", "addressregion", "state", "bundesland"]) ?? "").trim() || null,
        street,
        latitude: hasPoint ? latitude : null,
        longitude: hasPoint ? longitude : null,
        propertyType,
        listingKind,
        yearBuilt: year(pick(records, ["objyearconstructed", "yearconstructed", "yearbuilt", "baujahr", "constructionyear"])),
        yearRefurbished: year(pick(records, ["objlastrefurbishment", "lastrefurbishment", "yearrefurbished"])),
        energyClass: energyClass(pick(records, ["objenergyefficiencyclass", "energyefficiencyclass", "energieeffizienzklasse", "energyclass"])),
        energyKwh: parseDeNumber(pick(records, ["objthermalcharacteristic", "thermalcharacteristic", "endenergieverbrauch", "endenergiebedarf", "energykwh"])),
        energyCert: energyCert(pick(records, ["objbuildingenergyratingtype", "buildingenergyratingtype", "energycertificatetype", "energycert"])),
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
    const keyValues = assignedObject(blob, "keyValues");
    if (keyValues) records.push(keyValues);
    const fields = regexFields(blob);
    if (Object.keys(fields).length) records.push(fields);
    records.push(...jsonRecords(doc));
    const labeled = domRecord(doc);
    if (Object.keys(labeled).length) records.push(labeled);
    return buildListing(records, { href, title: pageTitle(doc), text: pageText(doc) });
  }

  globalThis.duomoExtract = extractListing;
  globalThis.duomoBuildListing = buildListing;
})();
