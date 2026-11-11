"""
SYNTHETIC reconstruction of the Google Sheet 'Inventory: Madtown' (Sheet1, To buy, Not yet sorted).
The real sheet was NOT supplied with the spec; only ~17 rows appear in Appendix A. This file rebuilds
103/25/10 rows that reproduce every statistic and data-quality quirk the spec documents (sections 4.2,
6.2, 11.2-11.3, Appendix A, Appendix C) so the importer and acceptance tests can run on staging (A3).
Rows the spec names use the documented values; every other row is labelled 'Synthetic ...'.
Replace with the real CSV export before sign-off (DECISIONS D-34).
"""
import csv, os, random
random.seed(7)
OUT = os.path.join(os.path.dirname(__file__), "sheet")
F = lambda i: f"https://drive.google.com/file/d/1SYN{i:04d}FileStockAbCdEf/view?usp=sharing"
L = lambda i: f"https://drive.google.com/file/d/1SYN{i:04d}FileLatestXyZ/view?usp=sharing"
D = lambda i: f"https://drive.google.com/drive/folders/1SYN{i:04d}FolderQwErTy"

rows = {}
def put(i, name, model="", typ="Accessory", stock="1", cond="Good", pos="Madtown", notes="", cin=""):
    rows[i] = dict(id=f"MTMH_{i}", name=name, model=model, type=typ, stock=stock, cond=cond, pos=pos, notes=notes, cin=cin)

# ---- documented rows (Appendix A and sections 4.2, 5, 11, C) ----
put(101, "Sony FX3", "ILME-FX3", "Camera", notes="Serviced on 14th July")
put(102, "Synthetic Camera 102", "", "Camera", notes="Serviced on 14th July")
put(103, "Sony A74", "ILCE-7M4", "Camera", notes="Serviced on 14th July. Was loaned to Chiru; returned by Chiru on 16 Oct 2026 (not 15 Oct).", cin="Friday, October 16, 2026")
put(104, "Synthetic Lens 104", "SYN-104", "Lens")
put(105, "Synthetic Lens 105", "", "Lens", notes="Serviced on 14th July")
put(106, "Sony 16-35mm G-Master F/2.8", "", "Lens", cond="Repairing", pos="Anand",
    notes="Sent for repair: issue with zoom and focus movement (noted 16 Oct 2026). Damaged in transit because the lens cells shifted inside the carrier.")
put(107, "Sony 90mm  Lens F/2.8", "SEL90M28G", "Lens", notes="Serviced on 14th July")
put(108, "Synthetic  Lens 108", "", "Lens", notes="Serviced on 14th July")
put(109, "DJI Mic 2", "", "Audio", notes="Charging cable missing (noted 16 Oct 2026).")
put(110, "E-Image EI-7060-AA", "EI-7060-AA", "Tripod", stock="2", pos="Madtown, Kittu")
put(111, "Fotopro Predator Tripod", "", "Tripod", cond="Lost", pos="Lost", notes="Lost a long time ago; how and when unknown (noted 16 Oct 2026).")
put(112, "Synthetic Light 112", "", "Light")
put(113, "Powerpak 5 in 1 Reflector", "", "Reflector", pos="Kittu")
put(114, "Powerpak 100x170 cms Reflector", "", "Reflector", pos="Kittu")
put(115, "Godox V1S Flash", "V1S", "Light", pos="Anand", notes="Belongs to Anand, not Madtown (per Naveen, 16 Oct 2026).")
put(116, "Godox AKR1 Kit", "AK-R1", "Light accessory ", notes="A few accessories missing. Case needs replacing.")
put(117, "Synthetic Stand 117", "", "Stand", stock="2", pos="Kittu, Madtown")
put(118, "Synthetic Light 118", "", "Light", pos="Kittu")
put(119, "Godox AD600 PRO Flash", "AD600Pro", "Light", pos="Madtown, Anand", notes="Battery and charger with Anand for timely charging. Needs a proper carry bag.")
put(120, "Godox QT600 III", "QT600IIIM", "Light", cond="Bad condition", notes="Used out of the retail box with thermocol; no proper case.")
put(122, "Godox LC 1000R", "LC1000R", "Light", notes="Type-C charger missing.")
put(123, "Godox QR-P120 Softbox", "QR-P120", "Light accessory ", cond="Lost", pos="Lost", notes="Lost during the Dasara shoot a couple of years ago (noted 16 Oct 2026).")
put(126, "Harison Pro Tower Stand", "", "Stand", stock="4", pos="Madtown, Kittu",
    notes="Stock shows 4, but one is missing and one was replaced or misplaced when loaned to Purushotham about a year ago. Confirm actual count.")
put(127, "Synthetic Monitor 127", "", "Accessory", notes="Needs a case.")
put(130, "Synthetic Light 130", "", "Light", pos="Kittu", notes="Loaned to Kittu for an event shoot; not returned yet (noted 16 Oct 2026).")
for i, mm in zip(range(132, 136), ("62", "67", "77", "82")):
    put(i, f"NISI UV Filter {mm}mm", f"NISI-UV-{mm}", "Accessory", cond="Bad condition", notes="Heavily scratched.")
put(138, "DJI Air 2S", "", "Drone", cond="Bad condition",
    notes="Only one battery remains; two lost. Loaned out and came back in very bad shape. Original case went bad. All cables missing. Remote in bad condition.")
put(139, "Anker Card Reader", "", "Accessory", cond="Lost", pos="Lost", notes="Lost at the old DoER office.")
put(140, "First Power NP-FZ100 Battery", "NP-FZ100", "Battery", stock="4", cond="Bad condition")
put(141, "Sony NP-FZ100 Battery", "NP-FZ100", "Battery", stock="6")
put(142, "Synthetic Light accessory 142", "", "Light accessory ", pos="Kittu")
put(145, "Lexar Professional 80GB Gold Series CF Express Type A card", "LCAGOLD080G-RNENG", "SD Card", stock="3", pos="Nagi, Kittu",
    notes="One card lost at Shorefest by Samuel, who was responsible for it (noted 16 Oct 2026).")
put(148, "K&F Camera Sling Bag ( Camouflage )", "", "Accessory", pos="Chiru")
put(150, "DJI Osmo Pocket 3", "", "Camera", notes="Windscreen and charging cable missing.")
put(156, "Synthetic Audio 156", "", "Audio", notes="Dead cat windscreen missing.")
put(158, "Digitex F750 Battery", "F750", "Battery", stock="2")
put(159, "Smart Pro F750 Battery Charger", "", "Accessory", cond="Lost", pos="Lost", notes="Charger lost (noted 16 Oct 2026). Only the charger is lost; the F750 batteries (MTMH_158) are not lost.")
put(161, "NISI 82mm CPL Filter", "NISI-CPL-82", "Light accessory ")
put(162, "Ulanzi Camera Cooling Fan", "", "Accessory", cond="Lost", pos="Lost", notes="Lost; not sure when or where.")
put(163, "SmallRig Cage for FX3", "", "Accessory")
put(164, "SmallRig Mount for FX3", "", "Accessory")
put(165, "SmallRig Top Handle for FX3", "", "Accessory")
put(166, "SmallRig Side Handle for FX3", "", "Accessory")
put(167, "Synthetic Accessory 167", "", "Accessory", cond="Bad condition", notes="Mounting screw missing.")
for k, i in enumerate(range(168, 179)):
    if i == 172: put(172, "Godox SA-05 - Scrim Set", "SA-05", "Light accessory ", notes="All in one carton box")
    else: put(i, f"Godox SA attachment (synthetic {i})", f"SA-{k+1:02d}" if k < 6 else "", "Light accessory ", notes="All in one carton box")
put(182, "DJI RS4 Pro Combo Gimbal", "RS4 Pro", "Accessory")
put(183, "DJI RS BG70 Battery Grip", "BG70", "Accessory")
put(184, "DJI RS Twist Grip", "", "Accessory")
put(185, "Synthetic CFexpress Type A card 185", "", "SD Card")
put(186, "Synthetic micro SD card 186", "", "SD Card")
put(187, "SanDisk Extreme 128GB", "", "SD Card", notes="Anand's Card")
put(189, "Magic line Photo Studio Trolley Case", "", "Accessory")
put(190, "Ulanzi Hard Shell Camera Bag", "", "Accessory")
put(191, "Small Spring Clamps pack of 20", "", "Accessory", stock="20", pos="Madtown, Kittu")
put(193, "Kodak Digital Camera Battery", "", "Accessory")
put(194, "Synthetic Backdrop 194", "", "Backdrops")
put(195, "Synthetic Backdrop 195", "", "Backdrops")
put(196, "Synthetic Accessory 196", "", "Accessory", cond="", pos="")
put(197, "Sony BC-QZ1 Battery Charger (for NP-FZ100)", "BC-QZ1", "Accessory", stock="3", cond="", pos="", notes="Stock of 3 is TO VERIFY.")
for i in range(198, 202): put(i, f"Synthetic Accessory {i}", "", "Accessory", stock="", cond="", pos="", notes="Details to come from Anand.")
put(202, "Lighting Umbrella", "TBD, Naveen to provide", "Light accessory", stock="", cond="", pos="")
put(203, "NEEWER X17 II Remote Teleprompter", "X17 II", "Accessory", pos="",
    notes="Bought from Kamal Imaging on 19 Sep 2026, order KI/SO/30101, Rs 21,999 incl GST (order KI/SO/30093 cancelled). Confirm RT113 remote and carrying case with Anand.")

# ---- fill remaining ids with clearly synthetic rows ----
fill_types = ["Light accessory ", "Light accessory ", "Accessory", "Stand", "Light", "Audio", "Reflector", "Tripod", "Accessory", "Backdrops"]
k = 0
for i in range(101, 204):
    if i not in rows:
        t = fill_types[k % len(fill_types)]; k += 1
        rows[i] = dict(id=f"MTMH_{i}", name=f"Synthetic {t.strip()} {i}", model="", type=t, stock="1", cond="Good", pos="Madtown", notes="", cin="")

# ---- balance Types to the spec: Accessory 44, 'Light accessory ' 17 (+1 without space: MTMH_202)
from collections import Counter as _C
def tcount(): return _C(r["type"] for r in rows.values())
synth = [i for i in sorted(rows) if rows[i]["name"].startswith("Synthetic ") and rows[i]["name"].split()[1] in ("Light", "Accessory", "Stand", "Audio", "Reflector", "Tripod", "Backdrop")]
for i in synth:
    if tcount()["Light accessory "] > 17 and rows[i]["type"] == "Light accessory ":
        rows[i]["type"] = "Accessory"; rows[i]["name"] = rows[i]["name"].replace("Light accessory", "Accessory")
for i in synth:
    if tcount()["Accessory"] < 44 and rows[i]["type"] in ("Stand", "Audio", "Reflector", "Tripod", "Light") and i not in (112, 117, 118, 130, 156):
        old = rows[i]["type"]; rows[i]["type"] = "Accessory"; rows[i]["name"] = rows[i]["name"].replace(old, "Accessory")

# ---- tune Posession counts to the spec: Madtown 68, Kittu 9, Anand 6, Lost 5, blank 8, Chiru 1, 'Madtown, Kittu' 3,
#      'Kittu, Madtown' 1, 'Madtown, Anand' 1, 'Nagi, Kittu' 1  (sum 103)
def count(f, v): return sum(1 for r in rows.values() if r[f] == v)
need = {"Kittu": 9, "Anand": 6}
pool = [i for i in range(101, 204) if rows[i]["pos"] == "Madtown" and rows[i]["name"].startswith("Synthetic") and rows[i]["stock"] == "1"]
for who, n in need.items():
    while count("pos", who) < n: rows[pool.pop(0)]["pos"] = who
# condition: Good 82, Bad 8, Lost 5, Repairing 1, blank 7
pool2 = [i for i in range(101, 204) if rows[i]["cond"] == "Good" and rows[i]["name"].startswith("Synthetic") and rows[i]["pos"] == "Madtown"]
while count("cond", "Bad condition") < 8: rows[pool2.pop()]["cond"] = "Bad condition"

# ---- model numbers: 43 rows filled
filled = [i for i in rows if rows[i]["model"]]
cand = [i for i in rows if not rows[i]["model"] and rows[i]["name"].startswith("Synthetic") and i not in (102, 105, 108, 196, 198, 199, 200, 201)]
while len(filled) < 43:
    i = cand.pop(0); rows[i]["model"] = f"SYN-{i}"; filled.append(i)

# ---- names: 15 trailing spaces (107/108 also have double spaces)
trail = [i for i in sorted(rows) if rows[i]["name"].startswith("Synthetic") and "  " not in rows[i]["name"]][:15]
for i in trail: rows[i]["name"] += " "

# ---- photo links. Stock: folder for 101,102,103,110,112,119; blank for 187,193-196,198-202 (10 rows)
no_stock = {187, 193, 194, 195, 196, 198, 199, 200, 201, 202}
folder = {101, 102, 103, 110, 112, 119}
# Updated links: text 'lost'/'Need replacement' on 11 rows, blank on 10 (incl 187)
text_rows = {111: "lost", 123: "lost", 139: "lost", 159: "lost", 162: "lost", 114: "lost",
             132: "Need replacement", 133: "Need replacement", 134: "Need replacement", 135: "Need replacement", 138: "Need replacement"}
blank_latest = {187, 196, 197, 198, 199, 200, 201, 202, 203, 193}
for i, r in rows.items():
    r["links"] = "" if i in no_stock else (D(i) if i in folder else F(i))
    r["updated"] = text_rows.get(i, "" if i in blank_latest else L(i))

# ---- write Sheet1 (MTMH_145 has a trailing space in its Item ID)
hdr = ["Item ID", "Item name", "Model Number", "Type", "Stock", "Links", "Updated links", "Notes", "Condition", "Posession", "Checked Out For", "Checked Out Date", "Checked In Date"]
with open(os.path.join(OUT, "Sheet1.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(hdr)
    for i in range(101, 204):
        r = rows[i]
        w.writerow([r["id"] + (" " if i == 145 else ""), r["name"], r["model"], r["type"], r["stock"], r["links"], r["updated"], r["notes"], r["cond"], r["pos"], "", "", r["cin"]])

# ---- To buy (25 lines). First rows documented; remainder synthetic. Prices are SYNTHETIC (for masking tests).
tb = [
 ("Hard camera and lens case", "Lens damaged in transit in the soft carrier (MTMH_106). Pelican 1510 hard case suggested.", "MTMH_106 (and camera and lens items MTMH_101 to 108)", "Adds (replaces soft carrier for transport)", "High", "To buy", "Pelican 1510 about Rs 18,500 (synthetic price)"),
 ("Replacement NiSi UV filters (62, 67, 77, 82 mm)", "Heavily scratched", "MTMH_132, MTMH_133, MTMH_134, MTMH_135", "Replaces", "Medium", "To research", ""),
 ("Second Mobius Chrom 14ft stand bag", "Mobius Chrom stand bag holds 2 Harison stands, not 4", "MTMH_126", "Adds", "Medium", "To buy", ""),
 ("DJI Air 2S Intelligent Flight Battery x2", "Two of three batteries lost", "MTMH_138", "Replaces", "High", "To buy", "Options: Pooja Electronics Rs 8,500; Flyworldgadget Rs 8,900; Design Info Rs 9,200 (synthetic prices)"),
 ("Sony BC-QZ1 battery charger: confirm count, buy up to 3", "Stock of 3 is TO VERIFY", "MTMH_197", "Adds", "Medium", "To research", "Confirm count with Anand first"),
 ("DJI Mic 2 charging cable", "Charging cable missing", "MTMH_109", "Replaces", "Medium", "To buy", ""),
 ("Godox AKR1 case and missing accessories", "A few accessories missing; case needs replacing", "MTMH_116", "Replaces (case) and adds (missing accessories)", "Low", "To research", ""),
 ("Smart Pro F750 battery charger", "Charger lost; batteries MTMH_158 not lost", "MTMH_159, MTMH_158", "Replaces", "High", "To buy", ""),
 ("Carry bag for Godox AD600 PRO", "Needs a proper carry bag", "MTMH_119", "Adds", "Medium", "To buy", ""),
 ("Hard case for monitor", "Monitor has no case", "MTMH_127", "Adds", "Low", "To research", ""),
 ("Case for Godox QT600 III", "Used from the retail box with thermocol", "MTMH_120", "Adds", "Medium", "To research", ""),
 ("Type-C charger for Godox LC 1000R", "Type-C charger missing", "MTMH_122", "Replaces", "Medium", "To buy", ""),
 ("DJI Osmo Pocket 3 windscreen and charging cable", "Windscreen and charging cable missing", "MTMH_150", "Replaces", "Low", "To buy", ""),
 ("DJI Air 2S cables", "All cables missing", "MTMH_138", "Replaces", "Medium", "To buy", ""),
 ("DJI Air 2S remote controller", "Remote in bad condition", "MTMH_138", "Replaces", "Medium", "To research", ""),
 ("DJI Air 2S carry case", "Original case went bad", "MTMH_138", "Replaces", "Low", "To research", ""),
]
for n in range(len(tb) + 1, 26):
    tb.append((f"Synthetic to-buy line {n}", "Synthetic reason", f"MTMH_{100 + n * 3}", random.choice(["Adds", "Replaces"]), random.choice(["High", "Medium", "Low"]), random.choice(["To buy", "To research"]), ""))
with open(os.path.join(OUT, "To buy.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["Item", "Reason", "Related item ID", "Replaces or adds", "Priority", "Status", "Notes"])
    for r in tb: w.writerow(r)

ns = [
 ("Gimbal accessories", "Several accessories for the gimbal", "Kit or separate items?", "Naveen (how to record); Anand (what exists)", "Undecided"),
 ("GoPro", "A GoPro was owned; whereabouts unknown", "Model, purchase details, accessories", "Naveen (model, purchase); Anand (accessories, search)", "Missing: to locate"),
 ("Hard disks (several)", "Several hard disks in the office", "How many, which capacities", "Anand; Naveen", "To list"),
 ("SanDisk Extreme 128GB SD card", "Possibly the same card as MTMH_187", "Duplicate of MTMH_187?", "Anand; Naveen", "To verify"),
 ("Paper backdrops (5 to 10)", "5 to 10 paper backdrops", "Exact count and colours", "Anand", "To list"),
 ("Nikon camera with accessories", "A Nikon camera and accessories", "Model and accessories", "Anand", "To clarify"),
 ("Canon camera with accessories", "A Canon camera and accessories", "Model and accessories", "Anand", "To clarify"),
 ("FX3 accessories", "Further FX3 accessories not in Sheet1", "Which ones", "Anand", "To list"),
 ("Teleprompter accessories", "RT113 remote and carrying case", "Separate items or part of MTMH_203?", "Anand", "To clarify"),
 ("Synthetic unsorted row 10", "Synthetic", "Synthetic question", "Anand", "Undecided"),
]
with open(os.path.join(OUT, "Not yet sorted.csv"), "w", newline="") as f:
    w = csv.writer(f); w.writerow(["Item", "What we know", "Question", "Who can answer", "Status"])
    for r in ns: w.writerow(r)

# ---- self-check against the spec's statistics
from collections import Counter
c = Counter(r["cond"] for r in rows.values()); p = Counter(r["pos"] for r in rows.values()); t = Counter(r["type"] for r in rows.values())
print("Condition", dict(c)); print("Posession", dict(p)); print("Types", dict(t))
print("models", sum(1 for r in rows.values() if r["model"]), "trailing names", sum(1 for r in rows.values() if r["name"] != r["name"].rstrip()))
print("no stock image", sum(1 for r in rows.values() if not r["links"]), "text latest", sum(1 for r in rows.values() if r["updated"] in ("lost", "Need replacement")), "blank latest", sum(1 for r in rows.values() if not r["updated"]))
assert c == Counter({"Good": 82, "Bad condition": 8, "Lost": 5, "Repairing": 1, "": 7}), c
assert p["Madtown"] == 68 and p["Kittu"] == 9 and p["Anand"] == 6 and p["Lost"] == 5 and p[""] == 8 and p["Chiru"] == 1 and p["Madtown, Kittu"] == 3, p
assert t["Accessory"] == 44, t["Accessory"]
assert t["Light accessory "] == 17 and t["Light accessory"] == 1, (t["Light accessory "], t["Light accessory"])
assert sum(1 for r in rows.values() if r["model"]) == 43
assert sum(1 for r in rows.values() if r["name"] != r["name"].rstrip()) == 15
print("fixture OK: 103 / 25 / 10 rows")
