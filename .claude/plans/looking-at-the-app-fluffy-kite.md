# File four tracked issues for analysis gaps

## Context
The user asked what DuomoGrid is missing in data and analytics. From the review of `src/domain/analyze.ts`,
`src/domain/compare.ts`, the schema and the desk, they chose four gaps to track as GitHub issues. This step only files
them. It changes no code.

Repo conventions, checked: there is no issue template and no open epic. The only commit scope in use is `feat(score)`.
Issues carry the `enhancement` label, and their bodies use `## Context`, `## Scope` and `## Acceptance criteria`, as #27
does.

## Issues to file (`gh issue create --label enhancement`)

1. **`feat(score): count maintenance, Grundsteuer and insurance in the monthly cost`**
   - Context: `analyze.ts:278` sets `monthlyCondoFee = 0` for houses, so `monthlyTotal` leaves out upkeep, property tax
     and insurance. Apartments carry those inside the Hausgeld, which makes a house look cheaper and lifts its
     Affordability subscore.
   - Scope:
     - New assumptions: maintenance EUR/m² per year, scaled by building age; Grundsteuer EUR per year as a flat default;
       insurance EUR/m² per year.
     - Apply them to houses (and to `multi`).
     - An apartment keeps the Hausgeld only.
     - New `Analysis` fields, mirrored in `web/src/api.ts`, plus rows in the "Each month" section of the desk.
   - Acceptance:
     - Exact-value tests.
     - A null living area gives a null maintenance cost, never 0.
     - Apartment results are unchanged.
     - Skill §6 is updated, in both copies.

2. **`feat: fixed-rate period, remaining debt and rate sensitivity`**
   - Scope:
     - `fixedYears` assumption (default 10), normalised in `assumptions.ts`.
     - Report the remaining debt at the end of the fixed-rate period (`remainingDebtEur`).
     - Report the monthly payment for that remaining debt over the rest of the term, at the current rate +1 and
       +2 percentage points.
     - Show these in the cash-to-close and financing section, and add a field to the Assumptions form.
   - Acceptance:
     - Amortization tests against a hand-computed schedule.
     - `fixedYears >= termYears` gives a remaining debt of 0.
     - Fields are null when there is no loan.

3. **`feat: compare buying and renting on net wealth over a horizon`**
   - Context: `rentAgainstBuy` (`compare.ts:46`) compares `monthlyTotal`, which includes principal, with the median cold
     rent.
   - Scope:
     - Count only unrecoverable costs: interest, maintenance, Grundsteuer, insurance, the purchase costs spread over the
       horizon, and the opportunity cost of equity at an assumed return.
     - Compare those against rent with an assumed rent growth.
     - Also report net wealth after N years for each path.
     - New assumptions: horizon, return on equity, appreciation, rent growth.
     - Keep the median cold rent of saved rentals as the rent basis.
   - Acceptance:
     - Exact-value tests.
     - Null when there is no rent sample or the monthly cost is incomplete.
     - Rentals stay unscored.
     - This is not a score input.
   - `blocked_by` issue 1, which provides maintenance, Grundsteuer and insurance.

4. **`feat: the highest price that fits the budget or a target score`**
   - Scope:
     - Solve for the asking price at which `monthlyTotal` equals `monthlyBudgetEur`. Run `analyze()` with the price
       varied and bisect on it, so tax, commission and parking stay consistent.
     - Optionally also solve for the price at which the score reaches 65 ("worth a look").
     - Show both on the detail view of buy listings.
   - Acceptance:
     - Null without a budget or with an incomplete monthly cost.
     - A test that plugging the solved price back into `analyze()` hits the budget within 1 EUR.

## Steps
1. Create issue 1, then issues 2 to 4, with the bodies above in full spec form.
2. Set the `blocked_by` dependency of issue 3 on issue 1:
   `gh api repos/{owner}/{repo}/issues/<3>/dependencies/blocked_by -f issue_id=<id of 1>`.
3. Add issues 1 to 4 to the "What is not here yet" list in README? No. That needs a PR, and the user only asked for
   issues. Leave it out.

## Verification
- `gh issue list --state open` shows the four new issues with the `enhancement` label.
- `gh api repos/{owner}/{repo}/issues/<3>/dependencies/blocked_by` lists issue 1.
