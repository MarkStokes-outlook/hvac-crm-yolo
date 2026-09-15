# YOLO Methodology

## Objective

Measure the result of developing an HVAC operations application
using a modern autonomous coding agent under realistic developer
conditions without structured context engineering.

## Agent-visible information

The agent receives:

- the initial product brief
- the contents of /reference
- answers to questions it independently chooses to ask
- its own evolving application source code

## Stakeholder interaction

The agent may ask arbitrary questions.

Answers must:

- accurately reflect the canonical HVAC business model
- answer only the question asked
- avoid volunteering additional requirements
- avoid steering implementation decisions

## Developer intervention

Permitted:

- answering questions
- resolving environment/access problems
- asking the agent to continue
- reporting genuine runtime/build failures

Not permitted:

- identifying missing domain concepts
- suggesting architecture
- providing the canonical HVAC reference corpus
- coaching against benchmark scenarios
- introducing requirements the agent did not discover

## Ground truth

The canonical HVAC business reference model is deliberately
not available to the development agent.

It is used subsequently for evaluation.