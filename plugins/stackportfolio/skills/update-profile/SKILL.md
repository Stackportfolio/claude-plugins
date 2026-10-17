---
name: update-profile
description: Use when the user wants to change their Stackportfolio headline, experience level, git usernames, job-seeking status, salary preferences, or availability.
allowed-tools:
  - get_profile
  - update_profile
---

# /stackportfolio:update-profile

Update your Stackportfolio developer profile: headline, experience level, git usernames, job-seeking status, salary preferences, or availability.

## Overview

This skill allows you to inspect and modify developer tech profile information on Stackportfolio directly from your coding agent.

## Rules & Constraints

1. **Credibility through evidence**: Never invent technologies or qualifications. Profile claims (such as job titles, git usernames, and salary expectations) should accurately reflect verified experience. Technologies and proficiency are derived solely from evidenced projects.
2. **Proficiency is computed**: Technologies, skills, and proficiency levels are NOT set on the profile; they are automatically calculated by Stackportfolio based on the projects you contribute to.
3. **Confirm before destructive calls**: If clearing optional profile fields (setting them to `null`), confirm with the user first.
4. **Verbatim error surfacing**: Report all API errors in the exact `{error: {code, message}}` structure returned by the server.
5. **Scope error recovery**: If an API error indicates insufficient scope, instruct the user to re-run `/mcp` (or run `claude mcp login stackportfolio`) to re-authorize with required profile scopes.
6. **No project deletion**: `projects:delete` is not granted in OAuth scopes; never attempt or promise project deletion.

## Workflow

### Step 1: Read Current Profile
Call `get_profile` to inspect current settings:
- `title`: Job title / headline (e.g. "Senior Full-Stack Engineer")
- `experienceLevel`: Experience tier (`junior`, `mid`, `senior`, `lead`)
- `githubUsername`: GitHub handle
- `gitlabUsername`: GitLab handle
- `bitbucketUsername`: Bitbucket handle
- `seekingEmployment`: Actively seeking employment (`true` / `false`)
- `openToOpportunities`: Open to job offers (`true` / `false`)
- `preferredSalaryMin` & `preferredSalaryMax`: Expected compensation bounds
- `salaryCurrency`: Salary currency (`USD`, `EUR`, `GBP`, `CAD`)
- `availableDate`: Earliest date available to start work (`yyyy-mm-dd`)
- `areas` & `indicator`: Computed technology domain distribution and generalist/specialist indicator (read-only)

### Step 2: Determine Changes
Ask the user or review their request for what supported tech profile fields need updating:
- Headline / Job title (`title`)
- Experience level (`experienceLevel`)
- External Git handles (`githubUsername`, `gitlabUsername`, `bitbucketUsername`)
- Job search preferences (`seekingEmployment`, `openToOpportunities`)
- Salary bounds and currency (`preferredSalaryMin`, `preferredSalaryMax`, `salaryCurrency`)
- Availability start date (`availableDate` in `yyyy-mm-dd` format)

*Important restrictions*:
- `bio` is a user account property, not part of `tech_profiles`, and is neither returned by `get_profile` nor accepted by `update_profile`.
- Profile visibility is an account preference and is not managed via `update_profile`.
- Technologies and proficiency are derived automatically by Stackportfolio from projects, not edited directly on the profile.

### Step 3: Apply Updates
Call `update_profile` passing only the fields to change.
- Optional fields (`preferredSalaryMin`, `preferredSalaryMax`, `availableDate`, git handles) can be cleared by sending `null`.
- Unchanged fields should be omitted from the update payload.

### Step 4: Summary
Output the updated profile summary and provide a link to view the public profile on Stackportfolio (`https://stackportfol.io/<username>`).
