import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  commitStacks, MAX_ROWS, parseImport, planImport, summarizePlan,
  type ImportPlan, type ParseResult, type PlannedStack,
} from '@upkeep/domain';
import { useApp } from '../AppProvider';
import { writer } from '../backend';
import { Button, Choices, DismissingNotice, Notice } from '../components/ui';
import { errorMessage } from '../errors';
import { resolveRows } from '../importResolve';
import { makeStyles } from '../preferences';
import { border, radius, space, state, surface, text, type } from '../theme';

/**
 * Add many cards at once from pasted text (a decklist or a CSV copied out of
 * Moxfield, ManaBox, Archidekt...). Collection only; decks are imported on the
 * web.
 *
 * Paste -> preview -> confirm -> progress -> result. The preview runs the same
 * `planImport` the commit uses, so "we will add 412 cards" means what the
 * commit then does. Nothing is written until Confirm.
 *
 * Writes go one stack at a time through the scan writer (`apply_stack_addition`,
 * migration 36). Each stack gets its operation id when the import is confirmed
 * and KEEPS it across retries: a stack whose first attempt actually landed
 * before the connection dropped is recognised by the database and returned as
 * already-done rather than added twice. That is also why the plan is frozen
 * once confirmed -- a changed stack under a reused id would be rejected.
 */

type Item = { operationId: string; stack: PlannedStack };
type Step = 'paste' | 'checking' | 'preview' | 'saving' | 'done';

const CONDITION_CHOICES = ['NM', 'LP', 'MP', 'HP', 'DMG'];
const UNSORTED = 'unsorted';
const SHOWN = 8;

export function ImportScreen() {
  const app = useApp();
  const styles = useStyles();
  const [step, setStep] = useState<Step>('paste');
  const [input, setInput] = useState('');
  const [condition, setCondition] = useState('NM');
  const [where, setWhere] = useState(UNSORTED);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [added, setAdded] = useState<Item[]>([]);
  const [pending, setPending] = useState<{ item: Item; error: string }[]>([]);
  const [untried, setUntried] = useState<Item[]>([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  // Frozen at confirm time; see the header.
  const items = useRef<Item[]>([]);

  const places = app.locations.filter(l => l.type !== 'deck');
  const placeLabels: Record<string, string> = { [UNSORTED]: 'Unsorted', ...Object.fromEntries(places.map(l => [l.id, l.name])) };

  if (!writer || app.demo) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.heading}>Import</Text>
        <Notice>Importing needs a signed-in account and the card database. Finish setup first, then come back.</Notice>
      </ScrollView>
    );
  }

  async function check() {
    app.setMessage('');
    const result = parseImport(input);
    if (result.rows.length === 0) {
      app.setMessage(result.problems.length ? 'None of those lines could be read as cards.' : 'Paste a list of cards first.');
      return;
    }
    if (result.rows.length > MAX_ROWS) { app.setMessage(`That is a lot at once. Try ${MAX_ROWS} lines or fewer.`); return; }
    setStep('checking');
    try {
      const resolved = await resolveRows(result.rows);
      if (!alive.current) return;
      setParsed(result);
      setPlan(planImport(resolved, {
        condition: condition as 'NM', finish: 'nonfoil', language: 'en',
        locationId: where === UNSORTED ? null : where,
      }));
      setStep('preview');
    } catch (e) {
      if (!alive.current) return;
      app.setMessage(errorMessage(e));
      setStep('paste');
    }
  }

  async function run(list: Item[]) {
    setStep('saving');
    setProgress({ done: 0, total: list.length });
    const out = await commitStacks(list, async ({ operationId, stack }) => {
      await writer!.save({
        operationId,
        draft: {
          card_id: stack.card_id, condition: stack.condition, finish: stack.finish, language: stack.language,
          quantity: stack.quantity, location_id: stack.location_id, notes: null,
        },
      });
    }, {
      onProgress: (done, total) => { if (alive.current) setProgress({ done, total }); },
      describeError: errorMessage,
    });
    if (!alive.current) return;
    setAdded(prev => [...prev, ...out.succeeded]);
    setPending(out.failed);
    setUntried(out.untried);
    setStep('done');
  }

  function confirm() {
    if (!plan) return;
    items.current = plan.stacks.map(stack => ({ operationId: Crypto.randomUUID(), stack }));
    setAdded([]);
    void run(items.current);
  }

  function retry() {
    void run([...pending.map(p => p.item), ...untried]);
  }

  function startOver() {
    items.current = [];
    setInput(''); setParsed(null); setPlan(null); setAdded([]); setPending([]); setUntried([]);
    setStep('paste');
  }

  const summary = plan ? summarizePlan(plan) : null;
  const addedCards = added.reduce((n, i) => n + i.stack.quantity, 0);
  const notDone = pending.length + untried.length;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Import</Text>
      {!!app.message && <DismissingNotice onDone={() => app.setMessage('')}>{app.message}</DismissingNotice>}

      {(step === 'paste' || step === 'checking') && (
        <>
          <Text style={styles.body}>Paste a list of cards, like “4 Lightning Bolt”, or a CSV copied from Moxfield, ManaBox or Archidekt. Nothing is added until you confirm.</Text>
          <TextInput
            style={styles.input}
            multiline
            value={input}
            onChangeText={setInput}
            editable={step === 'paste'}
            placeholder={'4 Lightning Bolt\n1 Sol Ring (C21) 263'}
            placeholderTextColor={text.secondary}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Cards to import"
          />
          <Text style={styles.label}>Condition for cards that do not say</Text>
          <Choices values={CONDITION_CHOICES} selected={condition} disabled={step === 'checking'} onSelect={setCondition} />
          <Text style={styles.label}>Put them in</Text>
          <Choices values={[UNSORTED, ...places.map(l => l.id)]} selected={where} disabled={step === 'checking'} onSelect={setWhere} labels={placeLabels} />
          <Button label={step === 'checking' ? 'Looking up your cards…' : 'Preview'} disabled={step === 'checking' || !input.trim()} onPress={() => void check()} />
        </>
      )}

      {step === 'preview' && plan && summary && parsed && (
        <>
          <View style={styles.card}>
            <Text style={styles.big}>{summary.cards} card{summary.cards === 1 ? '' : 's'} ready to add</Text>
            <Text style={styles.body}>
              {summary.stacks} entr{summary.stacks === 1 ? 'y' : 'ies'} in {where === UNSORTED ? 'Unsorted' : placeLabels[where]}. Copies you already own of the same card are added to their existing stack.
            </Text>
          </View>
          {(summary.needAttention > 0 || parsed.problems.length > 0) && (
            <View style={styles.card}>
              <Text style={styles.title}>Needs your attention</Text>
              <Text style={styles.body}>These lines will be left out. You can fix them and paste again, or add those cards by search.</Text>
              {plan.skippedRows.slice(0, SHOWN).map(r => <Text key={r.line} style={styles.bad}>{r.name}: {r.reason}</Text>)}
              {parsed.problems.slice(0, SHOWN).map(p => <Text key={`p${p.line}`} style={styles.bad}>“{p.raw}”: {p.reason}</Text>)}
              {plan.skippedRows.length + parsed.problems.length > SHOWN * 2 && <Text style={styles.body}>…and more.</Text>}
            </View>
          )}
          {summary.withWarnings > 0 && (
            <View style={styles.card}>
              <Text style={styles.title}>Worth a look</Text>
              {plan.rows.filter(r => r.card && r.warnings.length > 0).slice(0, SHOWN).map(r => (
                <Text key={r.line} style={styles.body}>{r.name}: {r.warnings.join(' ')}</Text>
              ))}
            </View>
          )}
          <Button label={`Add ${summary.cards} card${summary.cards === 1 ? '' : 's'}`} disabled={summary.cards === 0} onPress={confirm} />
          <Button secondary label="Back" onPress={() => setStep('paste')} />
        </>
      )}

      {step === 'saving' && (
        <View style={styles.card}>
          <Text style={styles.title}>Adding your cards…</Text>
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}>
            <View style={[styles.fill, { width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }]} />
          </View>
          <Text style={styles.body}>{progress.done} of {progress.total}. Keep the app open.</Text>
        </View>
      )}

      {step === 'done' && (
        <>
          <View style={styles.card}>
            <Text style={styles.big}>{addedCards} card{addedCards === 1 ? '' : 's'} added</Text>
            {notDone > 0
              ? <Text style={styles.body}>{notDone} entr{notDone === 1 ? 'y' : 'ies'} did not go through. Nothing is lost or doubled if you try again.</Text>
              : <Text style={styles.body}>Everything went in. You will find it in your collection.</Text>}
          </View>
          {pending.slice(0, SHOWN).map(p => (
            <Text key={p.item.operationId} style={styles.bad}>{p.item.stack.quantity} × {plan?.rows.find(r => p.item.stack.lines.includes(r.line))?.name ?? 'card'}: {p.error}</Text>
          ))}
          {notDone > 0 && <Button label="Try the rest again" onPress={retry} />}
          <Button secondary label="Import more" onPress={startOver} />
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles(() => StyleSheet.create({
  page: { padding: space.xxl, paddingBottom: 40, gap: space.md },
  heading: { ...type.title, color: text.primary },
  title: { ...type.title, fontSize: 16, lineHeight: 22, color: text.primary },
  big: { ...type.title, color: text.primary },
  body: { ...type.bodySm, color: text.secondary },
  label: { ...type.bodySm, color: text.primary },
  bad: { ...type.bodySm, color: state.error },
  input: { minHeight: 180, padding: space.md, textAlignVertical: 'top', borderRadius: radius.md, borderWidth: 1, borderColor: border.strong, backgroundColor: surface.raised, color: text.primary },
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: surface.raised, borderWidth: 1, borderColor: border.hairline },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: surface.sunken, overflow: 'hidden' },
  fill: { height: 10, borderRadius: radius.pill, backgroundColor: state.success },
}));
