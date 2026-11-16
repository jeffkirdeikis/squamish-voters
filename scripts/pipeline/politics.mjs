// Political news goes first on /news/, the home page news block and the Friday email (Jeff, Nov 15 2026).
// Political = council and election stories, plus any other story whose headline is about government: budgets, taxes,
// bylaws, council, the mayor, MLAs, MPs, Ottawa or Victoria. A story can override the rule with "politics": true or false.
const SECTIONS = new Set(['council', 'vote']);
const GOV = /\b(budget|property tax|taxes|council|councill?or|mayor|bylaws?|referendum|elect(ed|ion)|MLA|MP|ministers?|premier|Ottawa|Victoria|federal|provincial|legislature|parliament|government|Province|regional district|District of Squamish formally)\b/i;
export const isPolitics = (st) => (typeof st.politics === 'boolean' ? st.politics : SECTIONS.has(st.s) || (st.s !== 'safety' && st.s !== 'weather' && GOV.test(st.head || '')));
