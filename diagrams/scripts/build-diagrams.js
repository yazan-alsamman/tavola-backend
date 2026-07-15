/**
 * Generates all TAVLA architecture diagrams as clean, color-coded .drawio files.
 * Usage: node diagrams/scripts/build-diagrams.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Palette — one consistent meaning per color across every diagram
// ---------------------------------------------------------------------------
const COLOR = {
  presentation: { fill: '#dae8fc', stroke: '#6c8ebf' }, // blue
  application: { fill: '#e1d5e7', stroke: '#9673a6' }, // purple
  domain: { fill: '#d5e8d4', stroke: '#82b366' }, // green
  infrastructure: { fill: '#ffe6cc', stroke: '#d79b00' }, // orange
  guard: { fill: '#fff2cc', stroke: '#d6b656' }, // yellow
  actor: { fill: '#f5f5f5', stroke: '#666666' }, // neutral gray
  pending: { fill: '#f8f9fa', stroke: '#b3b3b3' }, // dashed gray = not yet implemented
  identity: { fill: '#dae8fc', stroke: '#6c8ebf' },
  auth: { fill: '#d5e8d4', stroke: '#82b366' },
  rbac: { fill: '#e1d5e7', stroke: '#9673a6' },
  restaurant: { fill: '#ffe6cc', stroke: '#d79b00' },
  platform: { fill: '#f5f5f5', stroke: '#666666' },
};

function esc(v) {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class Diagram {
  constructor() {
    this.n = 2;
    this.cells = [];
  }

  nid() {
    return `n${this.n++}`;
  }

  vertex(label, x, y, w, h, style, parent = '1') {
    const id = this.nid();
    this.cells.push(
      `        <mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" as="geometry"/></mxCell>`,
    );
    return id;
  }

  edge(source, target, style, label = '') {
    const id = this.nid();
    this.cells.push(
      `        <mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
    );
    return id;
  }

  freeEdge(x1, y1, x2, y2, style, label = '', waypoints = []) {
    const id = this.nid();
    const pts = waypoints.map((p) => `<mxPoint x="${round(p[0])}" y="${round(p[1])}"/>`).join('');
    const pointsXml = waypoints.length ? `<Array as="points">${pts}</Array>` : '';
    this.cells.push(
      `        <mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="${round(x1)}" y="${round(y1)}" as="sourcePoint"/><mxPoint x="${round(x2)}" y="${round(y2)}" as="targetPoint"/>${pointsXml}</mxGeometry></mxCell>`,
    );
    return id;
  }

  build(pageW, pageH) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="TAVLA" version="24.0.0" type="device">
  <diagram name="Page-1" id="page-1">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${round(pageW)}" pageHeight="${round(pageH)}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${this.cells.join('\n')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
  }
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function write(name, xml) {
  fs.writeFileSync(path.join(OUT, `${name}.drawio`), xml, 'utf8');
  console.log('wrote', `${name}.drawio`);
}

function title(d, text, x = 40, y = 10, w = 900) {
  d.vertex(
    text,
    x,
    y,
    w,
    30,
    'text;html=1;fontSize=18;fontStyle=1;align=left;verticalAlign=middle;fontColor=#1a1a1a;',
  );
}

function boxStyle(color, extra = '') {
  return `rounded=1;whiteSpace=wrap;html=1;fillColor=${color.fill};strokeColor=${color.stroke};fontSize=12;spacing=6;${extra}`;
}

function pendingStyle(extra = '') {
  return `rounded=1;whiteSpace=wrap;html=1;fillColor=${COLOR.pending.fill};strokeColor=${COLOR.pending.stroke};dashed=1;fontSize=12;fontColor=#888888;spacing=6;${extra}`;
}

// ---------------------------------------------------------------------------
// Legend helper
// ---------------------------------------------------------------------------
function legend(d, x, y, entries) {
  const rowH = 26;
  const w = 260;
  const h = 16 + entries.length * rowH;
  d.vertex(
    '',
    x,
    y,
    w,
    h,
    'rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#cccccc;verticalAlign=top;align=left;',
  );
  d.vertex(
    'Legend',
    x + 10,
    y + 6,
    w - 20,
    18,
    'text;html=1;fontSize=11;fontStyle=1;align=left;fontColor=#666666;',
  );
  entries.forEach((entry, i) => {
    const ey = y + 30 + i * rowH;
    if (entry.line) {
      d.freeEdge(x + 12, ey + 8, x + 40, ey + 8, entry.style);
    } else {
      d.vertex('', x + 12, ey, 26, 16, entry.style);
    }
    d.vertex(
      entry.label,
      x + 48,
      ey - 2,
      w - 58,
      20,
      'text;html=1;fontSize=11;align=left;verticalAlign=middle;fontColor=#333333;',
    );
  });
  return h;
}

// ---------------------------------------------------------------------------
// Sequence diagram builder
// ---------------------------------------------------------------------------
const ROW_H = 46;

function stepsHeight(steps) {
  let h = 0;
  for (const step of steps) {
    if (step.type === 'message') h += ROW_H;
    else if (step.type === 'self') h += ROW_H + 12;
    else if (step.type === 'alt') h += 34 + stepsHeight(step.body) + 10 + 16;
  }
  return h;
}

function layoutSteps(d, xOf, xMinAll, xMaxAll, steps, startY) {
  let y = startY;
  for (const step of steps) {
    if (step.type === 'message') {
      const x1 = xOf[step.from];
      const x2 = xOf[step.to];
      const arrow = step.dashed ? 'endArrow=open;endFill=0;dashed=1;' : 'endArrow=block;endFill=1;';
      d.freeEdge(
        x1,
        y,
        x2,
        y,
        `html=1;${arrow}fontSize=11;align=center;verticalAlign=top;strokeColor=#37474f;fontColor=#263238;labelBackgroundColor=#ffffff;`,
        step.label,
      );
      y += ROW_H;
    } else if (step.type === 'self') {
      const x1 = xOf[step.on];
      const loopW = 60;
      d.freeEdge(
        x1,
        y,
        x1,
        y + 30,
        'html=1;endArrow=block;endFill=1;strokeColor=#37474f;fontColor=#263238;fontSize=11;align=left;spacingLeft=4;labelBackgroundColor=#ffffff;',
        step.label,
        [
          [x1 + loopW, y],
          [x1 + loopW, y + 30],
        ],
      );
      y += ROW_H + 12;
    } else if (step.type === 'alt') {
      const y0 = y;
      y += 34;
      y = layoutSteps(d, xOf, xMinAll, xMaxAll, step.body, y);
      const y1 = y + 10;
      d.vertex(
        `alt  ${step.label}`,
        xMinAll,
        y0,
        xMaxAll - xMinAll,
        y1 - y0,
        'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#90a4ae;dashed=1;verticalAlign=top;align=left;fontSize=11;fontStyle=1;spacingLeft=10;spacingTop=6;fontColor=#607d8b;',
      );
      y = y1 + 16;
    }
  }
  return y;
}

function buildSequence(name, titleText, participants, steps, legendEntries) {
  const d = new Diagram();
  const boxW = 168;
  const boxH = 50;
  const gap = 66;
  const spacing = boxW + gap;
  const startX = 40;
  const startY = 60;
  const lifelineTop = startY + boxH;

  title(d, titleText, startX, 12, spacing * participants.length);

  const xOf = {};
  participants.forEach((p, i) => {
    const x = startX + i * spacing;
    xOf[p.key] = x + boxW / 2;
    d.vertex(p.label, x, startY, boxW, boxH, boxStyle(p.color, 'fontStyle=1;'));
  });

  const xMinAll = Math.min(...participants.map((p) => xOf[p.key])) - 70;
  const xMaxAll = Math.max(...participants.map((p) => xOf[p.key])) + 70;

  const contentHeight = stepsHeight(steps);
  const bottomY = lifelineTop + 24 + contentHeight + 30;

  participants.forEach((p) => {
    d.freeEdge(
      xOf[p.key],
      lifelineTop,
      xOf[p.key],
      bottomY,
      'endArrow=none;dashed=1;strokeColor=#b0bec5;strokeWidth=1;html=1;',
    );
  });

  layoutSteps(d, xOf, xMinAll, xMaxAll, steps, lifelineTop + 24);

  const legendH = legend(d, startX, bottomY + 20, legendEntries);

  const pageW = startX * 2 + spacing * participants.length;
  const pageH = bottomY + 40 + legendH + 20;
  write(name, d.build(pageW, pageH));
}

// ---------------------------------------------------------------------------
// Layered / module-dependency diagram builder
// ---------------------------------------------------------------------------
function laneEdgeStyle(sourceLaneIdx, targetLaneIdx, dashed) {
  let exitX = 1;
  let exitY = 0.5;
  let entryX = 0;
  let entryY = 0.5;
  if (targetLaneIdx < sourceLaneIdx) {
    exitX = 0;
    entryX = 1;
  } else if (targetLaneIdx === sourceLaneIdx) {
    exitX = 0.5;
    exitY = 1;
    entryX = 0.5;
    entryY = 0;
  }
  const dashPart = dashed ? 'dashed=1;' : '';
  const arrow = dashed ? 'endArrow=block;endFill=0;' : 'endArrow=block;endFill=1;';
  return `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;exitX=${exitX};exitY=${exitY};exitDx=0;exitDy=0;entryX=${entryX};entryY=${entryY};entryDx=0;entryDy=0;${dashPart}${arrow}strokeColor=#607d8b;fontSize=10;`;
}

function buildLayered(name, titleText, lanes, edgeDefs, legendEntries) {
  const d = new Diagram();
  const laneW = 300;
  const laneGap = 40;
  const itemH = 50;
  const itemGap = 14;
  const startX = 40;
  const startY = 70;

  title(d, titleText, startX, 14, laneW * lanes.length);

  const ids = {};
  const laneIdx = {};
  let maxLaneHeight = 0;

  lanes.forEach((lane, li) => {
    const x = startX + li * (laneW + laneGap);
    const laneHeight = 50 + lane.items.length * (itemH + itemGap);
    maxLaneHeight = Math.max(maxLaneHeight, laneHeight);
    const groupId = d.vertex(
      lane.name,
      x,
      startY,
      laneW,
      laneHeight,
      `swimlane;whiteSpace=wrap;html=1;startSize=32;fontSize=13;fontStyle=1;fillColor=${lane.color.fill};strokeColor=${lane.color.stroke};swimlaneFillColor=#ffffff;`,
    );
    lane.items.forEach((item, ii) => {
      laneIdx[item.key] = li;
      const itemColor = item.color || lane.color;
      const style = item.pending
        ? pendingStyle('align=left;spacingLeft=10;')
        : boxStyle(itemColor, 'align=left;spacingLeft=10;');
      const label = item.pending ? `${item.label}  (pending)` : item.label;
      const id = d.vertex(
        label,
        20,
        50 + ii * (itemH + itemGap),
        laneW - 40,
        itemH,
        style,
        groupId,
      );
      ids[item.key] = id;
    });
  });

  edgeDefs.forEach((e) => {
    const style = laneEdgeStyle(laneIdx[e.from], laneIdx[e.to], e.dashed);
    d.edge(ids[e.from], ids[e.to], style, e.label || '');
  });

  const legendY = startY + maxLaneHeight + 30;
  const legendH = legend(d, startX, legendY, legendEntries);

  const pageW = startX * 2 + lanes.length * (laneW + laneGap);
  const pageH = legendY + legendH + 40;
  write(name, d.build(pageW, pageH));
}

// ---------------------------------------------------------------------------
// ER diagram builder (bounded-context bands + crow's-foot relationships)
// ---------------------------------------------------------------------------
function fieldLines(entity) {
  const lines = [entity.name, '━'.repeat(Math.max(entity.name.length, 14))];
  for (const f of entity.fields) {
    let tag = '';
    if (f.pk) tag = '  PK';
    else if (f.fk) tag = '  FK';
    else if (f.uk) tag = '  UK';
    lines.push(`${f.name} : ${f.type}${tag}`);
  }
  if (entity.footer) lines.push(entity.footer);
  if (entity.note) lines.push(entity.note);
  return lines;
}

function erEdgeStyle(kind) {
  // kind: 'one-to-many' | 'one-to-one'
  if (kind === 'one-to-one') {
    return 'edgeStyle=entityRelationEdgeStyle;html=1;startArrow=ERone;startFill=0;endArrow=ERone;endFill=0;rounded=0;strokeColor=#546e7a;fontSize=9;fontColor=#546e7a;';
  }
  return 'edgeStyle=entityRelationEdgeStyle;html=1;startArrow=ERone;startFill=0;endArrow=ERmany;endFill=0;rounded=0;strokeColor=#546e7a;fontSize=9;fontColor=#546e7a;';
}

function buildER(name, titleText, groups, relationships, legendEntries) {
  const d = new Diagram();
  const startX = 40;
  const startY = 60;
  const entityW = 250;
  const entityGap = 36;
  const bandGap = 46;
  const lineH = 16.5;

  title(d, titleText, startX, 12, 1100);

  const meta = {}; // name -> {id, x, y, w, h, bandIndex, colIndex}
  let bandY = startY;
  let maxBandRight = 0;

  groups.forEach((group, bi) => {
    const heights = group.entities.map((e) => 44 + fieldLines(e).length * lineH);
    const bandHeight = Math.max(...heights) + 56;
    const bandWidth = group.entities.length * (entityW + entityGap) - entityGap + 40;
    maxBandRight = Math.max(maxBandRight, startX + bandWidth);

    d.vertex(
      group.name,
      startX,
      bandY,
      bandWidth,
      bandHeight,
      `rounded=0;whiteSpace=wrap;html=1;fillColor=${group.color.fill};strokeColor=${group.color.stroke};opacity=25;verticalAlign=top;align=left;fontSize=13;fontStyle=1;spacingLeft=14;spacingTop=8;fontColor=#37474f;`,
    );
    d.vertex(
      group.name,
      startX,
      bandY,
      bandWidth,
      24,
      'text;html=1;fontSize=13;fontStyle=1;align=left;verticalAlign=middle;spacingLeft=14;fontColor=#37474f;',
    );

    group.entities.forEach((entity, ei) => {
      const x = startX + 20 + ei * (entityW + entityGap);
      const y = bandY + 40;
      const h = 44 + fieldLines(entity).length * lineH - (44 - 30);
      const lines = fieldLines(entity);
      const boxH = 30 + (lines.length - 2) * lineH + 14;
      const id = d.vertex(
        lines.join('\n'),
        x,
        y,
        entityW,
        boxH,
        `rounded=0;whiteSpace=wrap;html=0;fillColor=#ffffff;strokeColor=${group.color.stroke};strokeWidth=1.5;align=left;verticalAlign=top;spacing=8;fontSize=11;fontFamily=Consolas;`,
      );
      meta[entity.name] = { id, x, y, w: entityW, h: boxH, band: bi, col: ei };
    });

    bandY += bandHeight + bandGap;
  });

  relationships.forEach((rel) => {
    const a = meta[rel.from];
    const b = meta[rel.to];
    if (!a || !b) {
      throw new Error(`ER relationship references unknown entity: ${rel.from} -> ${rel.to}`);
    }
    d.edge(a.id, b.id, erEdgeStyle(rel.kind || 'one-to-many'), rel.label || '');
  });

  const legendY = bandY + 10;
  const legendH = legend(d, startX, legendY, legendEntries);

  const pageW = maxBandRight + 40;
  const pageH = legendY + legendH + 40;
  write(name, d.build(pageW, pageH));
}

module.exports = {
  COLOR,
  boxStyle,
  pendingStyle,
  buildSequence,
  buildLayered,
  buildER,
  title,
  legend,
  Diagram,
  write,
};
