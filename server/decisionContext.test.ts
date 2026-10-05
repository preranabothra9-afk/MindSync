import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
  buildDecisionContext,
  detectIntents,
  renderDecisionMemory,
  MAX_DECISION_CONTEXT_CHARS
} from './decisionContext';
import type { DecisionMemory } from './decisionContext';
import type { Claim, ClaimRelation, ContradictionDiscussion, Decision, Evidence } from '../src/types';

// ---------------------------------------------------------------------------
// The AI decision context: what a model is allowed to be told about a room's
// own history when someone asks it a record question.
//
// Two things are worth testing that neither a typecheck nor a happy-path run
// would catch: that an irrelevant question ships *nothing* (the whole point of
// relevance retrieval), and that a record question ships enough to answer it
// even though the room never phrased things the way the question does. The
// grounding header is asserted directly because it is the only thing standing
// between the record and an invented one.
// ---------------------------------------------------------------------------

const at = (n: number): string => `2026-10-0${n}T09:00:00.000Z`;

function makeClaim(id: string, text: string, n: number): Claim {
  return {
    id,
    conversationId: 'conv-ctx',
    messageId: `msg-${id}`,
    modelKey: 'gemini-2.5-flash',
    modelName: 'Gemini 2.5 Flash',
    text,
    createdAt: at(n)
  };
}

function makeEvidence(partial: Partial<Evidence> & { id: string; claimId: string; title: string }): Evidence {
  return {
    conversationId: 'conv-ctx',
    kind: 'url',
    url: null,
    fileName: null,
    mimeType: null,
    sizeBytes: null,
    data: null,
    excerpt: null,
    source: null,
    aiGenerated: false,
    modelName: null,
    authorId: 'u1',
    authorName: 'Prerana',
    createdAt: at(3),
    ...partial
  } as Evidence;
}

function makeRelation(partial: Partial<ClaimRelation> & { id: string }): ClaimRelation {
  return {
    conversationId: 'conv-ctx',
    claimAId: 'c1',
    claimBId: 'c2',
    claimAText: 'first claim',
    claimBText: 'second claim',
    claimAModelName: 'Gemini 2.5 Flash',
    claimBModelName: 'GPT-OSS 120B',
    relationship: 'CONTRADICT',
    confidence: 0.91,
    explanation: 'the two claims cannot both hold',
    status: 'detected',
    resolution: null,
    resolvedBy: null,
    resolvedByName: null,
    resolvedAt: null,
    citedEvidenceIds: [],
    createdAt: at(2),
    ...partial
  } as ClaimRelation;
}

/** A room that can answer all four of the questions in the brief. */
function fixture(): DecisionMemory {
  const claims: Claim[] = [
    makeClaim('c1', 'Redis keeps every key in memory, so a dataset larger than RAM cannot be stored.', 1),
    makeClaim('c2', 'Redis can persist datasets larger than RAM by spilling to disk.', 1),
    makeClaim('c3', 'Adding more web servers removes the database bottleneck entirely.', 2),
    makeClaim('c4', 'The cache hit rate stayed at 92% after the retry storm.', 3)
  ];

  const relations: ClaimRelation[] = [
    makeRelation({
      id: 'rel1',
      claimAId: 'c1',
      claimBId: 'c2',
      claimAText: claims[0].text,
      claimBText: claims[1].text,
      status: 'resolved',
      resolution:
        'We ran the benchmark: Redis OOMs at 92% of RAM in our test, so spilling is out for this workload.',
      resolvedBy: 'u1',
      resolvedByName: 'Prerana',
      resolvedAt: at(4),
      citedEvidenceIds: ['ev1'],
      explanation: 'One claim says Redis cannot exceed RAM, the other says it can.'
    }),
    // A thematic link, not a disagreement. It must never surface as one.
    makeRelation({
      id: 'rel2',
      relationship: 'RELATED',
      claimAId: 'c3',
      claimBId: 'c4',
      claimAText: 'Adding more web servers removes the database bottleneck entirely.',
      claimBText: 'The cache hit rate stayed at 92% after the retry storm.'
    })
  ];

  const evidenceByClaim: Record<string, Evidence[]> = {
    c1: [
      makeEvidence({ id: 'ev1', claimId: 'c1', title: 'Redis maxmemory docs', url: 'https://redis.io/docs/data/expiration' }),
      makeEvidence({
        id: 'ev2',
        claimId: 'c1',
        title: 'Our benchmark run',
        kind: 'quote',
        excerpt: 'OOM at 92% of RAM after 40 minutes of load.',
        authorName: 'Ayan',
        createdAt: at(4)
      })
    ],
    c2: [
      makeEvidence({
        id: 'ev3',
        claimId: 'c2',
        title: 'Model reference for spilling',
        aiGenerated: true,
        modelName: 'Gemini 2.5 Flash',
        createdAt: at(2)
      })
    ]
  };

  const decisions: Decision[] = [
    {
      id: 'd1',
      conversationId: 'conv-ctx',
      title: 'Choose the cache layer for the retry pipeline',
      statement:
        'We will use Redis with a 24 GB cap and take datasets larger than RAM out of scope.',
      claimIds: ['c1'],
      requiredApproverIds: ['u2', 'u3'],
      approvals: [{ userId: 'u2', userName: 'Ayan', approvedAt: at(5) }],
      status: 'finalized',
      createdBy: 'u1',
      createdByName: 'Prerana',
      finalizedAt: at(6),
      finalizedBy: 'u1',
      finalizedByName: 'Prerana',
      history: [
        { action: 'created', actorId: 'u1', actorName: 'Prerana', detail: 'Drafted after the benchmark.', at: at(2) },
        {
          action: 'finalized',
          actorId: 'u1',
          actorName: 'Prerana',
          detail: 'Finalized once the benchmark confirmed the cap.',
          at: at(6)
        }
      ],
      createdAt: at(2)
    }
  ];

  const discussions: Record<string, ContradictionDiscussion> = {
    rel1: {
      comments: [
        {
          id: 'cm1',
          relationId: 'rel1',
          conversationId: 'conv-ctx',
          authorId: 'u1',
          authorName: 'Prerana',
          authorAvatar: 'P',
          text: 'The docs are explicit: eviction starts at maxmemory, there is no spilling.',
          createdAt: at(3)
        },
        {
          id: 'cm2',
          relationId: 'rel1',
          conversationId: 'conv-ctx',
          authorId: 'u2',
          authorName: 'Ayan',
          authorAvatar: 'A',
          text: 'Benchmark agrees, we ran out of memory at 92%.',
          createdAt: at(4)
        }
      ],
      votes: [
        { id: 'v1', relationId: 'rel1', conversationId: 'conv-ctx', userId: 'u1', userName: 'Prerana', choice: 'CLAIM_A', createdAt: at(4) },
        { id: 'v2', relationId: 'rel1', conversationId: 'conv-ctx', userId: 'u2', userName: 'Ayan', choice: 'CLAIM_A', createdAt: at(4) },
        { id: 'v3', relationId: 'rel1', conversationId: 'conv-ctx', userId: 'u3', userName: 'Ravi', choice: 'CLAIM_B', createdAt: at(4) }
      ]
    }
  };

  return {
    decisions,
    claims,
    relations,
    evidenceByClaim,
    discussions,
    members: [
      { id: 'u1', name: 'Prerana' },
      { id: 'u2', name: 'Ayan' },
      { id: 'u3', name: 'Ravi' }
    ]
  };
}

const MEM = fixture();

describe('question intents', () => {
  test('the four record questions each map to a record intent', () => {
    assert.deepEqual(detectIntents('What did we disagree about?'), ['disagreement']);
    assert.deepEqual(detectIntents('What evidence resolved it?'), ['evidence']);
    assert.deepEqual(detectIntents('Why did we choose this?'), ['decision']);
    assert.deepEqual(detectIntents('What is still uncertain?'), ['uncertainty']);
  });

  test('a question about something else maps to no intent at all', () => {
    assert.deepEqual(detectIntents('Write a haiku about the sea'), []);
  });

  test('a question can ask for more than one thing', () => {
    const intents = detectIntents('Why did we choose this, and what evidence backs it?');
    assert.ok(intents.includes('decision'));
    assert.ok(intents.includes('evidence'));
  });
});

describe('relevance', () => {
  test('an unrelated question ships none of the record', () => {
    assert.equal(renderDecisionMemory(MEM, 'Write a haiku about the sea'), '');
  });

  test('a disagreement question does not also ship every decision', () => {
    const out = renderDecisionMemory(MEM, 'What did we disagree about?');
    assert.ok(!out.includes('### Decisions'), 'decisions were not asked for and did not match');
    assert.match(out, /### Disagreements/);
  });

  test('an empty room still answers a record question instead of staying silent', () => {
    const empty: DecisionMemory = {
      decisions: [],
      claims: [],
      relations: [],
      evidenceByClaim: {},
      discussions: {},
      members: []
    };
    const out = renderDecisionMemory(empty, 'What did we disagree about?');
    assert.match(out, /\(none recorded\)/, 'the model must be told the section was empty');
    assert.ok(!out.includes('### Decisions') || out.includes('(none recorded)'));
  });
});

describe('grounding', () => {
  test('the rules header is present whenever anything is shipped', () => {
    const out = renderDecisionMemory(MEM, 'Why did we choose this?');
    assert.match(out, /ABSOLUTE RULES/);
    assert.match(out, /Never invent earlier events, claims/);
    assert.match(out, /If the record does not contain the answer, say plainly/);
  });

  test('a poll tally is labelled advice, never an outcome', () => {
    const out = renderDecisionMemory(MEM, 'What did we disagree about?');
    assert.match(out, /poll \(advice only, never the outcome\)/);
    assert.match(out, /claim A 2, claim B 1, neither \/ need more evidence 0/);
  });

  test('an AI reference is labelled unverified rather than as proof', () => {
    const out = renderDecisionMemory(MEM, 'What evidence resolved it?');
    assert.match(out, /UNVERIFIED, a lead to check, never proof/);
  });

  test('a RELATED edge never appears as a disagreement', () => {
    const onlyRelated: DecisionMemory = {
      ...MEM,
      relations: [makeRelation({ id: 'relX', relationship: 'RELATED' })]
    };
    const out = renderDecisionMemory(onlyRelated, 'What did we disagree about?');
    const section = out.slice(out.indexOf('### Disagreements'));
    assert.match(section, /\(none recorded\)/);
  });
});

describe('the four target questions', () => {
  test('"What did we disagree about?" quotes both sides and the resolution', () => {
    const out = renderDecisionMemory(MEM, 'What did we disagree about?');
    // Scoped to the disagreements section: the point is that the *edge* carries
    // both claims, not that the room's claim list happens to contain them.
    const start = out.indexOf('### Disagreements');
    const end = out.indexOf('### Claims');
    const section = end > start ? out.slice(start, end) : out.slice(start);
    assert.match(section, /Redis keeps every key in memory/);
    assert.match(section, /Redis can persist datasets larger than RAM/);
    assert.match(section, /resolved; closed by Prerana on 2026-10-04/);
    assert.match(section, /Redis OOMs at 92% of RAM in our test/);
    assert.match(section, /evidence cited when closing it: "Redis maxmemory docs"/);
    assert.match(section, /Prerana: "The docs are explicit/);
    assert.match(section, /poll \(advice only, never the outcome\)/);
  });

  test('"What evidence resolved it?" names the evidence and who attached it', () => {
    const out = renderDecisionMemory(MEM, 'What evidence resolved it?');
    assert.match(out, /### Evidence on record/);
    assert.match(out, /"Redis maxmemory docs"/);
    assert.match(out, /attached by Prerana/);
    assert.match(out, /"Our benchmark run"/);
    assert.match(out, /attached by Ayan/);
  });

  test('"Why did we choose this?" gives the statement, approvals and gate', () => {
    const out = renderDecisionMemory(MEM, 'Why did we choose this?');
    assert.match(out, /### Decisions/);
    assert.match(out, /Choose the cache layer for the retry pipeline/);
    assert.match(out, /24 GB cap/);
    assert.match(out, /status: finalized by Prerana on 2026-10-06/);
    assert.match(out, /approvals: 1 of 2 — Ayan approved; still outstanding from Ravi/);
    assert.match(out, /gate: 1 condition\(s\) outstanding/);
    assert.match(out, /last recorded step: 2026-10-06 — Prerana: Finalized once the benchmark/);
  });

  test('"What is still uncertain?" comes straight off the gate blockers', () => {
    const out = renderDecisionMemory(MEM, 'What is still uncertain?');
    assert.match(out, /### Still open or unresolved/);
    assert.match(out, /Choose the cache layer for the retry pipeline: 1 required approval still outstanding/);
  });
});

describe('bounding', () => {
  /** A deliberately enormous room: many claims, contradictions and evidence. */
  function crowded(): DecisionMemory {
    const claims: Claim[] = [];
    const relations: ClaimRelation[] = [];
    const evidenceByClaim: Record<string, Evidence[]> = {};
    for (let i = 0; i < 30; i++) {
      const id = `cc${i}`;
      claims.push(
        makeClaim(
          id,
          `Claim number ${i} about the redis cache layer and its throughput characteristics under load.`,
          1
        )
      );
      evidenceByClaim[id] = [
        makeEvidence({ id: `e${i}`, claimId: id, title: `Evidence ${i} for the throughput claim` })
      ];
      if (i > 0) {
        relations.push(
          makeRelation({
            id: `r${i}`,
            claimAId: id,
            claimBId: 'cc0',
            claimAText: claims[i].text,
            claimBText: claims[0].text,
            status: i % 5 === 0 ? 'detected' : 'resolved',
            resolution: i % 5 === 0 ? null : `Closed after reading evidence ${i}.`,
            createdAt: at((i % 9) + 1)
          })
        );
      }
    }
    return { decisions: [], claims, relations, evidenceByClaim, discussions: {}, members: [] };
  }

  test('the block never exceeds its character budget', () => {
    const out = renderDecisionMemory(crowded(), 'What did we disagree about?');
    assert.ok(
      out.length <= MAX_DECISION_CONTEXT_CHARS,
      `block was ${out.length} chars, budget ${MAX_DECISION_CONTEXT_CHARS}`
    );
  });

  test('truncation is announced rather than implied to be complete', () => {
    const out = renderDecisionMemory(crowded(), 'What did we disagree about?');
    assert.match(out, /### Disagreements \(contradictions between claims\) \(showing \d+ of 29\)/);
    assert.match(out, /"showing N of M" means the record was sliced/);
  });

  test('a record question in a huge room still surfaces the most relevant items', () => {
    const out = renderDecisionMemory(crowded(), 'What did we disagree about?');
    // Section ordering puts what was asked for first, so it always wins the budget.
    const disagreementsAt = out.indexOf('### Disagreements');
    const claimsAt = out.indexOf('### Claims');
    assert.ok(disagreementsAt > 0, 'disagreements section missing');
    if (claimsAt > 0) assert.ok(disagreementsAt < claimsAt, 'asked-for section lost the budget race');
  });
});

// ---------------------------------------------------------------------------
// The loader: a real room in an in-memory MongoDB. This is where the bounded
// queries happen, and it is the only place a silent regression (an empty
// section for a room that plainly has a record) could hide behind the pure
// renderer being correct.
// ---------------------------------------------------------------------------

describe('buildDecisionContext', () => {
  const CONV = 'conv-ctx-loader';
  let mongo: MongoMemoryServer;

  before(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongo.getUri();
    await mongoose.connect(mongo.getUri());

    const { ClaimModel, DecisionModel, EvidenceModel, ClaimRelationModel } = await import('./database');

    await ClaimModel.create({
      _id: 'c-load',
      conversationId: CONV,
      messageId: 'm-load',
      modelKey: 'gemini-2.5-flash',
      modelName: 'Gemini 2.5 Flash',
      text: 'The migration window is Sunday because the replica lag peaks midweek.',
      createdAt: at(1)
    });
    await DecisionModel.create({
      _id: 'd-load',
      conversationId: CONV,
      title: 'Pick the migration window',
      statement: 'We migrate on Sunday during the 03:00-05:00 UTC window.',
      claimIds: ['c-load'],
      requiredApproverIds: [],
      approvals: [],
      status: 'finalized',
      createdBy: 'u1',
      createdByName: 'Prerana',
      finalizedAt: at(2),
      finalizedBy: 'u1',
      finalizedByName: 'Prerana',
      history: [],
      createdAt: at(1)
    });
    await EvidenceModel.create({
      _id: 'e-load',
      conversationId: CONV,
      claimId: 'c-load',
      kind: 'url',
      title: 'Replica lag dashboard',
      url: 'https://example.internal/lag',
      aiGenerated: false,
      authorName: 'Prerana',
      createdAt: at(1)
    });
    await ClaimRelationModel.create({
      _id: 'r-load',
      conversationId: CONV,
      claimAId: 'c-load',
      claimBId: 'c-other',
      claimAText: 'The migration window is Sunday because the replica lag peaks midweek.',
      claimBText: 'The migration window is Monday because nobody works weekends.',
      claimAModelName: 'Gemini 2.5 Flash',
      claimBModelName: 'GPT-OSS 120B',
      relationship: 'CONTRADICT',
      confidence: 0.8,
      explanation: 'Sunday and Monday are different days.',
      status: 'resolved',
      resolution: 'Checked the on-call rota: Sunday is staffed, Monday is not.',
      resolvedByName: 'Prerana',
      resolvedAt: at(3),
      citedEvidenceIds: [],
      createdAt: at(2)
    });
  });

  after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  test('a room with a record answers a record question', async () => {
    const { section, hasDecisionContext } = await buildDecisionContext(
      CONV,
      'Why did we choose this?'
    );
    assert.equal(hasDecisionContext, true);
    assert.match(section, /Pick the migration window/);
    assert.match(section, /03:00-05:00 UTC window/);
    assert.ok(section.length <= MAX_DECISION_CONTEXT_CHARS);
  });

  test('a room with a record but an unrelated question ships nothing', async () => {
    const { section, hasDecisionContext } = await buildDecisionContext(
      CONV,
      'Write a haiku about the sea'
    );
    assert.equal(section, '');
    assert.equal(hasDecisionContext, false);
  });

  test('a room with no record at all returns nothing', async () => {
    const { section, hasDecisionContext } = await buildDecisionContext(
      'conv-does-not-exist',
      'What did we disagree about?'
    );
    assert.equal(section, '');
    assert.equal(hasDecisionContext, false);
  });

  // The loader being right is not enough: the record has to actually reach the
  // prompt, ahead of the question it is meant to answer. This is the seam the
  // socket writes out, so it is the seam worth asserting.
  test('the record reaches the composed prompt, ahead of the new question', async () => {
    const { buildRoomContext } = await import('./context');
    const { prompt, hasContext } = await buildRoomContext(CONV, 'Why did we choose this?');

    assert.equal(hasContext, true, 'hasContext drives whether web grounding is skipped');
    assert.match(prompt, /## Decision record/);
    assert.match(prompt, /Pick the migration window/);

    const recordAt = prompt.indexOf('## Decision record');
    const questionAt = prompt.indexOf('## New prompt to answer now');
    assert.ok(recordAt >= 0 && questionAt > recordAt, 'record must precede the question');
    assert.ok(prompt.trimEnd().endsWith('Why did we choose this?'), 'the question must survive intact');
  });

  test('an empty room passes the question straight through', async () => {
    const { buildRoomContext } = await import('./context');
    const { prompt, hasContext } = await buildRoomContext('conv-empty-here', 'Hello there');
    assert.equal(hasContext, false);
    assert.equal(prompt, 'Hello there');
  });
});
