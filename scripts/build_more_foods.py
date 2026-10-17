"""Builds more-foods.json: international food composition tables in the same compact form as
usda-foods.json (English names, per 100 g edible portion, energy in kcal, nutrients in g, sodium in mg).

Usage: python3 -I scripts/build_more_foods.py <raw-dir> <out.json>
<raw-dir> holds the official downloads, each in its own folder:
  foundation/x/FoodData_Central_foundation_food_json_2026-04-30.json   USDA Foundation Foods, April 2026
  cnf/x/*.csv                                                          Canadian Nutrient File 2026
  cofid/cofid2021.xlsx                                                 UK CoFID 2021
  ciqual/alim.xml + ciqual/table.xlsx                                  ANSES Ciqual 2025
  afcd/nutrients.xlsx                                                  FSANZ AFCD Release 3

Carbohydrate is total carbohydrate, as on US labels and in the USDA tables. CoFID, Ciqual and AFCD report
available carbohydrate (fibre excluded), so dietary fibre is added back where the table reports it.
"""
import csv
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xlsx import sheets  # noqa: E402

KJ_PER_KCAL = 4.184
# Dataset indexes continue usda-foods.json's (0 SR Legacy, 1 FNDDS).
FOUNDATION, CNF, COFID, CIQUAL, AFCD = 2, 3, 4, 5, 6


def num(v):
    """A table cell as a number: None when not reported; 0 for trace or below the detection limit."""
    s = str(v if v is not None else '').strip().replace(' ', ' ')
    if s in ('', '-', 'N', 'n', 'NA', 'nd', '—'):
        return None
    if s.lower() in ('tr', 'trace', 'traces') or s.startswith('<'):
        return 0.0
    s = s.replace(',', '.').strip('*() ')
    try:
        return float(s)
    except ValueError:
        return None


def row(fid, src, desc, kcal, protein, fat, carb, fiber, sugar, sodium, satfat):
    """One food in the shared layout, or None when the four main values aren't all reported."""
    if None in (kcal, protein, fat, carb) or not desc:
        return None
    if not (0 <= kcal <= 950 and all(0 <= x <= 100 for x in (protein, fat, carb))):
        return None
    r2 = lambda x: None if x is None else round(x, 2)
    return [fid, src, re.sub(r'\s+', ' ', desc).strip(), round(kcal), r2(protein), r2(fat), r2(carb), r2(fiber), r2(sugar),
            None if sodium is None else round(sodium), r2(satfat)]


def total_carb(available, fiber):
    return None if available is None else available + (fiber or 0)


def foundation(raw):
    path = next((raw / 'foundation' / 'x').glob('*.json'))
    foods, portions = [], {}
    for f in json.load(open(path))['FoundationFoods']:
        if not f:
            continue
        n = {}
        for x in f.get('foodNutrients') or []:
            nu = x.get('nutrient') or {}
            if x.get('amount') is not None and nu.get('number'):
                n[(nu['number'], nu.get('unitName'))] = x['amount']
        kcal = n.get(('208', 'kcal'))
        if kcal is None:
            kcal = n.get(('957', 'kcal'), n.get(('958', 'kcal')))
        if kcal is None and n.get(('268', 'kJ')) is not None:
            kcal = n[('268', 'kJ')] / KJ_PER_KCAL
        carb = n.get(('205', 'g'))
        if carb is None and n.get(('1050', 'g')) is not None:
            carb = total_carb(n[('1050', 'g')], n.get(('291', 'g')))
        r = row(f['fdcId'], FOUNDATION, f['description'], kcal, n.get(('203', 'g')), n.get(('204', 'g')), carb,
                n.get(('291', 'g')), n.get(('269', 'g'), n.get(('2000', 'g'))), n.get(('307', 'mg')), n.get(('606', 'g')))
        if not r:
            continue
        foods.append(r)
        ps = []
        for p in f.get('foodPortions') or []:
            g = p.get('gramWeight')
            label = (p.get('portionDescription') or ' '.join(str(x) for x in (
                p.get('amount') and f"{p['amount']:g}", (p.get('measureUnit') or {}).get('name'), p.get('modifier')) if x and x != 'undetermined')).strip()
            if g and label:
                ps.append([label[:60], round(g, 1)])
        if ps:
            portions[str(f['fdcId'])] = ps[:6]
    return foods, portions


def cnf(raw):
    d = raw / 'cnf' / 'x'
    rd = lambda fn: csv.DictReader(open(d / fn, encoding='utf-8-sig'))
    names = {r['Food_Code']: r for r in rd('Food_Name.csv')}
    want = {'208': 'kcal', '268': 'kj', '203': 'protein', '204': 'fat', '205': 'carb', '291': 'fiber', '269': 'sugar', '307': 'sodium', '606': 'satfat'}
    vals = {}
    for r in rd('Nutrient_Amount.csv'):
        k = want.get(r['Nutrient_Code'])
        if k:
            vals.setdefault(r['Food_Code'], {})[k] = num(r['Nutrient_Amount'])
    measure = {r['Measure_Code']: r['Measure_Description_and_Unit_EN'] for r in rd('Measure_Name.csv')}
    portions_by = {}
    for r in rd('Measure_Weight_Conversion.csv'):
        g = num(r['Measure_Weight_Conversion'])
        label = measure.get(r['Measure_Code'], '')
        if r['Measure_Type_Code'] == '6' and g and label:
            portions_by.setdefault(r['Food_Code'], []).append([label[:60], round(g, 1)])
    foods, portions, skipped = [], {}, 0
    for code, f in names.items():
        # Source 0 is "USDA data, no changes": already in the bundled USDA tables.
        if f['Food_Source_Code'] == '0':
            skipped += 1
            continue
        v = vals.get(code, {})
        kcal = v.get('kcal') if v.get('kcal') is not None else (v['kj'] / KJ_PER_KCAL if v.get('kj') is not None else None)
        r = row(f'cnf:{code}', CNF, f['Food_Description_EN'], kcal, v.get('protein'), v.get('fat'), v.get('carb'),
                v.get('fiber'), v.get('sugar'), v.get('sodium'), v.get('satfat'))
        if r:
            foods.append(r)
            if portions_by.get(code):
                portions[f'cnf:{code}'] = portions_by[code][:6]
    print(f'  CNF: skipped {skipped} unchanged copies of USDA foods', file=sys.stderr)
    return foods, portions


def table(rows, header_row=0):
    hdr = [re.sub(r'\s+', ' ', h).strip() for h in rows[header_row]]
    return hdr, [r + [''] * (len(hdr) - len(r)) for r in rows[header_row + 1:]]


def col(hdr, pattern):
    for i, h in enumerate(hdr):
        if re.search(pattern, h, re.I):
            return i
    raise KeyError(pattern)


def cofid(raw):
    sh = sheets(raw / 'cofid' / 'cofid2021.xlsx')
    hp, prox = table(sh['1.3 Proximates'])
    hi, inorg = table(sh['1.4 Inorganics'])
    sodium = {r[0]: num(r[col(hi, r'^Sodium \(mg\)')]) for r in inorg if r[0]}
    c = {k: col(hp, p) for k, p in {'code': r'^Food Code', 'name': r'^Food Name', 'kcal': r'^Energy \(kcal\)', 'protein': r'^Protein \(g\)',
                                     'fat': r'^Fat \(g\)', 'carb': r'^Carbohydrate \(g\)', 'sugar': r'^Total sugars', 'aoac': r'^AOAC fibre',
                                     'nsp': r'^NSP', 'satfat': r'^Satd FA /100g fd'}.items()}
    foods = []
    for r in prox:
        code = r[c['code']].strip()
        if not code:
            continue
        fiber = num(r[c['aoac']])
        if fiber is None:
            fiber = num(r[c['nsp']])
        out = row(f'uk:{code}', COFID, r[c['name']], num(r[c['kcal']]), num(r[c['protein']]), num(r[c['fat']]),
                  total_carb(num(r[c['carb']]), fiber), fiber, num(r[c['sugar']]), sodium.get(code), num(r[c['satfat']]))
        if out:
            foods.append(out)
    return foods, {}


def ciqual(raw):
    names = {}
    for a in ET.parse(raw / 'ciqual' / 'alim.xml').getroot().iter('ALIM'):
        code = (a.findtext('alim_code') or '').strip()
        eng = (a.findtext('alim_nom_eng') or '').strip()
        if code and eng:
            names[code] = eng
    sh = sheets(raw / 'ciqual' / 'table.xlsx')
    hdr, rows = table(sh['composition nutritionnelle'])
    c = {k: col(hdr, p) for k, p in {'code': r'^alim_code$', 'kcal': r'1169.*kcal', 'kcal2': r'Jones, avec fibres \(kcal',
                                      'protein': r'^Protéines, N x facteur de Jones', 'carb': r'^Glucides', 'fat': r'^Lipides',
                                      'sugar': r'^Sucres', 'fiber': r'^Fibres alimentaires', 'satfat': r'^AG saturés',
                                      'sodium': r'^Sodium \(mg'}.items()}
    foods, untranslated = [], 0
    for r in rows:
        code = r[c['code']].strip()
        if code not in names:
            untranslated += 1
            continue
        kcal = num(r[c['kcal']])
        if kcal is None:
            kcal = num(r[c['kcal2']])
        fiber = num(r[c['fiber']])
        out = row(f'fr:{code}', CIQUAL, names[code], kcal, num(r[c['protein']]), num(r[c['fat']]),
                  total_carb(num(r[c['carb']]), fiber), fiber, num(r[c['sugar']]), num(r[c['sodium']]), num(r[c['satfat']]))
        if out:
            foods.append(out)
    print(f'  Ciqual: skipped {untranslated} foods with no English name', file=sys.stderr)
    return foods, {}


def afcd(raw):
    sh = sheets(raw / 'afcd' / 'nutrients.xlsx')
    hdr, rows = table(sh['All solids & liquids per 100 g'], header_row=1)
    c = {k: col(hdr, p) for k, p in {'key': r'^Public Food Key', 'name': r'^Food Name', 'kj': r'^Energy with dietary fibre, equated',
                                      'protein': r'^Protein', 'fat': r'^Fat, total', 'fiber': r'^Total dietary fibre',
                                      'carb': r'^Available carbohydrate, with sugar alcohols', 'sugar': r'^Total sugars',
                                      'sodium': r'^Sodium \(Na\)', 'satfat': r'^Total saturated fatty acids, equated \(g\)'}.items()}
    foods = []
    for r in rows:
        key = r[c['key']].strip()
        if not key:
            continue
        kj, fiber = num(r[c['kj']]), num(r[c['fiber']])
        out = row(f'au:{key}', AFCD, r[c['name']], None if kj is None else kj / KJ_PER_KCAL, num(r[c['protein']]), num(r[c['fat']]),
                  total_carb(num(r[c['carb']]), fiber), fiber, num(r[c['sugar']]), num(r[c['sodium']]), num(r[c['satfat']]))
        if out:
            foods.append(out)
    return foods, {}


def main():
    raw, out = Path(sys.argv[1]), Path(sys.argv[2])
    foods, portions = [], {}
    for name, fn in [('USDA Foundation', foundation), ('CNF', cnf), ('CoFID', cofid), ('Ciqual', ciqual), ('AFCD', afcd)]:
        f, p = fn(raw)
        print(f'{name}: {len(f)} foods, {len(p)} with portions', file=sys.stderr)
        foods += f
        portions.update(p)
    meta = {
        'sources': [
            'USDA ARS, FoodData Central: Foundation Foods, April 2026 (public domain)',
            'Health Canada, Canadian Nutrient File 2026 (Open Government Licence – Canada)',
            'Public Health England, McCance and Widdowson’s Composition of Foods Integrated Dataset (CoFID) 2021 (Open Government Licence v3.0)',
            'ANSES, Ciqual French food composition table 2025 (Etalab Open Licence 2.0)',
            'Food Standards Australia New Zealand, Australian Food Composition Database Release 3, 2025 (CC BY 4.0)',
        ],
        'per': '100 g edible portion',
        'fields': ['id', 'src', 'description', 'kcal', 'protein_g', 'fat_g', 'carb_g', 'fiber_g', 'sugar_g', 'sodium_mg', 'satfat_g'],
        'notes': 'Energy in kcal (AFCD converted from kJ at 4.184 kJ/kcal). Carbohydrate is total carbohydrate: dietary fibre is added '
                 'to the available carbohydrate reported by CoFID, Ciqual and AFCD. Trace or below-detection values are 0; '
                 'unreported values are null.',
    }
    out.write_text(json.dumps({'meta': meta, 'foods': foods, 'portions': portions}, ensure_ascii=False, separators=(',', ':')))
    print(f'wrote {out}: {len(foods)} foods, {out.stat().st_size / 1e6:.2f} MB', file=sys.stderr)


if __name__ == '__main__':
    main()
