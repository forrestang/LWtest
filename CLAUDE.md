## Standard Workflow
1. First think through the problem, read the codebase for relevant files, and write a plan to tasks/todo.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Before you begin working, check in with me and I will verify the plan.
4. Then, begin working on the todo items, marking them as complete as you go.
5. Please every step of the way just give me a high level explanation of what changes you made
6. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
7. Finally, add a review section to the [todo.md] file with a summary of the changes you made and any other relevant information.
8. Do not output code diffs to terminal window.
9. FOllow my instructions.
   *E.g., if I say to install LightWeight Charts v5.0.8, don't install v4.0.
   E.g., if I tell you to run a specific API call to gecko terminal, do not run a different one, or do not run additional API calls thinking it would be good. 
   E.g., if I tell you to delete the console logging for debugging, don't also redirect those logs to the testing component unless I ask you to.
   *You can make a recommendation, but don't do things I don't ask you to, espectially when I explicitly tell you something to do.
14. If you add a component, give it a data-label attribute of some name so that I can reference it when pointing things out
15. I will add reference images to zImageRefs folder. So if I tell u to reference an image, that is likely where I have placed it.
16. If you start a server to check something, please kill that server when ur done, before you announce a given task to be complete.
17. **LocalStorage Prefix Protocol**: When adding any feature that requires localStorage, sessionStorage, IndexedDB, or any other client-side storage, ALWAYS use the prefix "LWtest" (short for LightweightTest) to namespace all storage keys. This prevents conflicts with other projects. Use ONLY "LWtest" prefix. Examples: `LWtest_chartTooltipShowState`, `LWtest_leftWidth`, `LWtest_priceMode`, etc. Never use generic keys like `userSettings` or `chartData`.
18. We are attempting to get D3FC to render the charts instead of plain d3.js.  DO NOT use regular d3.js fallbacks, it defeats the purpose of the project, which is to increase performance as d3 is barely usable.
17. If u add a component that is visible, it must have its own unique data label.
18. Only install the latest version of LightWeight charts which is v5.0.8, DO NOT USE OLDER MODELS.  Also, do NOT USE methods like addCandlestickSeries or addBarseries, etc... these mthods are depricated in the new version.
 below are examples of methods that work:
 * const barSeries = chart.addSeries(BarSeries,...
 * const candlestickSeries = chart.addSeries(CandlestickSeries,...
 * const lineSeries = chart.addSeries(LineSeries,...
 * If u need more reference, see this page: https://tradingview.github.io/lightweight-charts/docs/series-types