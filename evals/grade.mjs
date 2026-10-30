export function gradeTranscript(events, expect) {
  const calls = events.filter((event) => event.type === 'assistant')
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'tool_use')
    .map((block) => ({ name: block.name.replace(/^mcp__.+?__/, ''), input: block.input }));
  const failures = [];
  const matches = (name, alternatives) => alternatives.split('|').includes(name);
  for (const tool of expect.mustCall ?? []) {
    if (!calls.some((call) => call.name === tool)) failures.push(`Missing required tool: ${tool}`);
  }
  for (const tool of expect.mustNotCall ?? []) {
    if (calls.some((call) => call.name === tool)) failures.push(`Forbidden tool called: ${tool}`);
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
