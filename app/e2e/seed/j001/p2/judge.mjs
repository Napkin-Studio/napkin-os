// Judge's seed (features/judge.clan, contracts): the rubric the fixtures answer to, and the three scores of test 58 to 60.
// The fixture answers are in answers/judge_work*.json: idea 7 total 22 (returns to the team), idea 9 total 22 (Brave),
// total 24 (goes to the creative director). Reason codes are the verdict's: judge.return, judge.brave, judge.forward.
export const SCORES = {
  'score22-idea7': { total: 22, idea: 7, reason_code: 'judge.return', advised_route: 'team' },
  'score22-idea9': { total: 22, idea: 9, reason_code: 'judge.brave', advised_route: 'cd_brave' },
  score24: { total: 24, idea: 8, reason_code: 'judge.forward', advised_route: 'cd' },
}
export const OVERRULE_REASON = 'The line is rough but the thought is the one we want to keep.'
export const JUDGE_VERDICT_KEYS = ['kind', 'agent', 'handler', 'backend', 'version', 'targets', 'cites', 'polarity', 'reason_code', 'taxonomy_version', 'rationale', 'judge']
