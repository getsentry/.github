---
name: Deprecation Template
about: Template for documenting a proposed deprecation
---

<aside>
Please read the @Deprecation Policy before filing a deprecation request.

Work through the checklist and tick off completed items. Keep the checklist updated at any time throughout the deprecation process.

Do not forget to fill out the page properties at the top.
</aside>


### Checklist

- [ ]  Check if the change or deprecation can be avoided
*see [Avoiding Breaking Changes](https://www.notion.so/Avoiding-Breaking-Changes-93ff761ad830427795e3c6e895e9db2d) for reference*
- [ ]  Create a draft deprecation template
*replace all blue boxes in the [](https://www.notion.so/d023600714e04342aef6dd6c8b7aac68) template*
- [ ]  Discuss in TSC and receive approval
*create a discussion item in [Client Infra Technical Steering Committee (TSC)](https://www.notion.so/Client-Infra-Technical-Steering-Committee-TSC-95478d13008a47b7b1cd7ddf2e2151cb)*
- [ ]  Announce changes to primary stakeholders
- [ ]  Create a JIRA issue to schedule removal
*set the due date to the end of the deprecation time frame*
- [ ]  Make changes in code and documentation
    - [ ]  Update product and developer documentation
    [*https://docs.sentry.io/](https://docs.sentry.io/) and [https://develop.sentry.dev/](https://develop.sentry.dev/)*
    - [ ]  Mark affected source code and APIs as deprecated
    - [ ]  Add runtime deprecation warnings where appropriate
    - [ ]  Fill out communication template in the deprecation plan
    - [ ]  For critical changes, create migration code examples, tools
- [ ]  Ship deprecation
    - [ ]  Add notice in change log and readme
    - [ ]  Release / deploy deprecation
    - [ ]  Announce to Customer Success and Customer Support
    *Post the notice in #discuss-support*
- [ ]  After deprecation time frame has ended: Execute follow-up
    - [ ]  Remove functionality from source code
    - [ ]  Add notice in change log
    - [ ]  Release / deploy removal
    - [ ]  Clean up old or dead code


### Summary

<aside>
In 2-3 sentences, cover: 
- what functionality is removed
- what is the benefit
- what's the scope of impact
</aside>


### Background


<aside>
ℹ️ Reasoning & Impact (incl Reach)
- What benefits does this change offer
- WHY can't this be avoided?
- define our contract and commitment
</aside>
  
### Reach

<aside>
ℹ️ Describe in detail how reach and impact of the deprecation has been assessed.
- [usage statistics](https://www.notion.so/Tree-Shaking-Delivery-00aaff969f154b1f905817ffa8c2a7fa)
- (#orgs, platform)
- node, browsers, ts version support by their respective maintainer

</aside>


## Risk

<aside>
ℹ️ Why might this change fail? Check for unintentional consequences (UC). Consider performing a pre-mortem.

</aside>

## Decision

<aside>
ℹ️ Based on background, reach and risk there should be enough information to decide if we proceed, or adapt changes targeted, from a business case point of view.

</aside>

# Changes

<aside>
ℹ️ Describe in detail what is being removed, potentially linking to code or existing documentation. Also describe the effect of the removal, such as broken APIs and affected SDK versions.

[Readme example](https://www.npmjs.com/package/raven)

Package Manager examples
* [npm](https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions) 
* [PyPi](https://www.dampfkraft.com/code/how-to-deprecate-a-pypi-package.html)

</aside>

## Replacement

<aside>
ℹ️ Describe what will replace the removed functionality. Call out explicitly if there is no replacement.

</aside>

## Migration

<aside>
ℹ️ Describe how users or the system can migrate (measures to take to manage those changes as an SDK consumer [user]).

</aside>

## Removal

<aside>
ℹ️ Describe in great detail the steps that will be taken to remove the deprecated functionality at the end of the deprecation period.
- is a major version bump required
- how is the rollout performed
- how do we mitigate risk of unintended concequences

</aside>

# Communication

## Primary Stakeholders

<aside>
ℹ️ Who needs to be aware of the changes? Create a list of teams or people to inform internally ahead of carrying out the change, especially engineering teams affected or involved.

</aside>

- @Person
- XYZ Engineering Team

## Internal Announcement

<aside>
ℹ️ **To be filled out once accepted.** Write a short paragraph used to announce the deprecation. Should contain a link to this document.

</aside>

> Quote me.
> 

**Communication level:**

- [ ]  Slack channel `#discuss-support`
    - Channels to consider
        - #discuss-ingest
        - #discuss-open-source
        - #discuss-product-announcements
        - #discuss-sdks
            - #discuss-javascript
        - #discuss-security (if relevant)
        - #disccuss-singletenant
        - #discuss-se-lounge
        - #discuss-support
- [ ]  Shipped email to `engineering@sentry.io`
- [ ]  

## External Announcement

<aside>
ℹ️ **To be filled out once accepted.** Write a message to broadcast on external channels. Multiple channels of communication should be considered, but try to harmonize the message. **For every developer** also be sure to consider communicating it in a programatic way when it it is relevant

</aside>

> Quote me.
> 

**Channels:**

- [ ]  Tweet
- [ ]  Forum post
- [ ]  GitHub Issue
- [ ]  In-product broadcast (status.sentry.io marketing tool for targeted updates)
- [ ]  Other: __ (blog)
- [ ]  Email: monthly update

## Customer Support

<aside>
ℹ️ **To be filled out once accepted.** If we expect customers to write in about the change, write a canned response.

</aside>

> Quote me.
>
