// Text of a tool_result block: a string, or the joined text blocks of an array.
function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => (typeof item === 'string' ? item : item?.text ?? '')).join('');
  return content === undefined || content === null ? '' : JSON.stringify(content);
}

export function gradeTranscript(events, expect) {
  // stream-json puts each tool_result in a later user event, keyed by the tool_use id.
  const results = new Map();
  for (const event of events) {
    if (event.type !== 'user') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_result' && block.tool_use_id !== undefined) {
        results.set(block.tool_use_id, { ok: !block.is_error, text: resultText(block.content) });
      }
    }
  }
  const calls = events.filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'tool_use')
    .map((block) => {
      const result = block.id === undefined ? undefined : results.get(block.id);
      return {
        name: block.name.replace(/^mcp__.+?__/, ''), input: block.input,
        // A call with no recorded result never completed, so it is not a success.
        ok: result?.ok === true, error: result && !result.ok ? result.text : null, result: result?.ok ? result.text : '',
      };
    });
  const failures = [];
  const matches = (name, alternatives) => alternatives.split('|').includes(name);
  for (const tool of expect.mustCall ?? []) {
    if (!calls.some((call) => call.name === tool)) failures.push(`Missing required tool: ${tool}`);
  }
  for (const tool of expect.mustNotCall ?? []) {
    if (calls.some((call) => call.name === tool)) failures.push(`Forbidden tool called: ${tool}`);
  }
  for (const tool of expect.mustSucceed ?? []) {
    if (!calls.some((call) => call.name === tool && call.ok)) {
      const lastError = calls.filter((call) => call.name === tool && call.error !== null).at(-1)?.error;
      failures.push(`${tool} never succeeded${lastError ? `: ${lastError}` : ' (not called or no result)'}`);
    }
  }
  for (const tool of expect.mustNotFail ?? []) {
    const failed = calls.find((call) => call.name === tool && call.error !== null);
    if (failed) failures.push(`${tool} failed: ${failed.error}`);
  }
  for (const { tool, pattern } of expect.expectFailure ?? []) {
    const regex = new RegExp(pattern);
    if (!calls.some((call) => call.name === tool && call.error !== null && regex.test(call.error))) {
      failures.push(`No failed ${tool} call matches /${pattern}/`);
    }
  }
  for (const { tool, pattern } of expect.resultMatches ?? []) {
    const regex = new RegExp(pattern);
    if (!calls.some((call) => call.name === tool && call.ok && regex.test(call.result))) {
      failures.push(`No successful ${tool} result matches /${pattern}/`);
    }
  }
  for (const [a, b] of expect.order ?? []) {
    const firstB = calls.findIndex((call) => matches(call.name, b));
    if (firstB >= 0 && !calls.slice(0, firstB).some((call) => matches(call.name, a))) {
      failures.push(`Expected ${a} before first ${b}`);
    }
  }
  for (const { tool, path, pattern } of expect.argMatches ?? []) {
    const regex = new RegExp(pattern);
    if (!calls.some((call) => {
      if (call.name !== tool) return false;
      const value = path.split('.').reduce((value, key) => value?.[key], call.input);
      return value !== undefined && regex.test(typeof value === 'string' ? value : JSON.stringify(value));
    })) failures.push(`No ${tool} input at ${path} matches /${pattern}/`);
  }
  for (const { tool, path, pattern } of expect.argMustNotMatch ?? []) {
    const regex = new RegExp(pattern);
    if (calls.some((call) => {
      if (call.name !== tool) return false;
      const value = path.split('.').reduce((value, key) => value?.[key], call.input);
      return value !== undefined && regex.test(typeof value === 'string' ? value : JSON.stringify(value));
    })) failures.push(`Forbidden ${tool} input at ${path} matches /${pattern}/`);
  }
  if (expect.finalTextMatches !== undefined) {
    const finalResult = events.findLast((event) => event.type === 'result');
    if (!finalResult) failures.push('finalTextMatches: missing result event');
    else if (typeof finalResult.result !== 'string') failures.push('finalTextMatches: last result event has no result string');
    else if (!new RegExp(expect.finalTextMatches, 'i').test(finalResult.result)) {
      failures.push(`Final result text does not match /${expect.finalTextMatches}/i`);
    }
  }
  if (expect.finalTextNotMatches !== undefined) {
    const finalResult = events.findLast((event) => event.type === 'result');
    if (!finalResult) failures.push('finalTextNotMatches: missing result event');
    else if (typeof finalResult.result !== 'string') failures.push('finalTextNotMatches: last result event has no result string');
    else if (new RegExp(expect.finalTextNotMatches, 'i').test(finalResult.result)) {
      failures.push(`Final result text matches forbidden /${expect.finalTextNotMatches}/i`);
    }
  }
  return { pass: failures.length === 0, failures };
}
