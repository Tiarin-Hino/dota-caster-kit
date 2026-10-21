// Hero npc name (as in GSI, without "npc_dota_hero_") -> display name.
// Most names are derived automatically ("crystal_maiden" -> "Crystal Maiden"); this list holds the internal names that
// differ from the in-game name.
const SPECIAL = {
  abyssal_underlord: "Underlord", antimage: "Anti-Mage", centaur: "Centaur Warrunner", doom_bringer: "Doom",
  furion: "Nature's Prophet", keeper_of_the_light: "Keeper of the Light", life_stealer: "Lifestealer",
  magnataur: "Magnus", necrolyte: "Necrophos", nevermore: "Shadow Fiend", obsidian_destroyer: "Outworld Destroyer",
  queenofpain: "Queen of Pain", rattletrap: "Clockwerk", sand_king: "Sand King", shredder: "Timbersaw",
  skeleton_king: "Wraith King", treant: "Treant Protector", vengefulspirit: "Vengeful Spirit", windrunner: "Windranger",
  wisp: "Io", zuus: "Zeus", skywrath_mage: "Skywrath Mage", storm_spirit: "Storm Spirit", monkey_king: "Monkey King",
  winter_wyvern: "Winter Wyvern", dark_willow: "Dark Willow", primal_beast: "Primal Beast",
};

function heroName(npc) {
  if (!npc) return "";
  const n = String(npc).replace(/^npc_dota_hero_/, "");
  if (SPECIAL[n]) return SPECIAL[n];
  return n.split("_").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

module.exports = { heroName };
