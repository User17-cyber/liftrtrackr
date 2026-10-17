"""Minimal .xlsx reader using only the standard library (no openpyxl): yields each sheet's rows as lists of strings."""
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def _col(ref):
    n = 0
    for ch in re.match(r'[A-Z]+', ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def sheets(path):
    """Returns {sheet name: [[cell text, ...], ...]} for every sheet in the workbook."""
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = {r.get('Id'): r.get('Target') for r in rels}
    out = {}
    for s in wb.find('m:sheets', NS):
        rid = s.get('{%s}id' % NS['r'])
        part = target[rid].lstrip('/')
        part = part if part.startswith('xl/') else 'xl/' + part
        rows = []
        for row in ET.fromstring(z.read(part)).iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                v = c.find('m:v', NS)
                t = c.get('t')
                if t == 'inlineStr':
                    text = ''.join(x.text or '' for x in c.iter('{%s}t' % NS['m']))
                elif v is None:
                    continue
                elif t == 's':
                    text = shared[int(v.text)]
                else:
                    text = v.text or ''
                cells[_col(c.get('r'))] = text
            if cells:
                rows.append([cells.get(i, '') for i in range(max(cells) + 1)])
        out[s.get('name')] = rows
    return out
