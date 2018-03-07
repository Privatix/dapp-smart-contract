# Contributing to Privatix
:rocket: First off, thanks for taking the time to contribute! :rocket:

# How to contribute to Privatix

When contributing to this repository, please first discuss the change you wish to make via issue,
email, or any other method with the owners of this repository before making a change.

Please note we have a [code of conduct](CODE_OF_CONDUCT.md), please follow it in all your interactions with the project.

## Did you find a bug?

* Ensure the bug was not already reported by searching on GitHub under [Issues](https://github.com/Privatix/dapp-smart-contract/issues).
* If you're unable to find an open issue addressing the problem, open a [new one](https://github.com/Privatix/dapp-smart-contract/issues/new). Be sure to include a title and clear description, as much relevant information as possible, and a code sample or an executable test case demonstrating the expected behavior that is not occurring.

## Did you find a documentation mistake?

You have two options:
1. Create an [Issue](https://github.com/Privatix/dapp-smart-contract/issues/new).
1. Fix mistake by yourself and open new Pull Request for approval.

## Did you write a patch that fixes a bug?

* Open a new GitHub pull request with the patch.
* Ensure the PR description clearly describes the problem and solution. Include the relevant issue number if applicable.
* Wait for approval.

# Coding conventions

## Branching

We follow [git-flow branching model](http://nvie.com/posts/a-successful-git-branching-model/).

Please use follow prefixes:
* feature/
* hotfix/
* release/

As feature name use Issue number. Eg `feature/42`.

We suggest you to use [git-flow extensions](https://github.com/nvie/gitflow).

For better understanding, take a look at [git-flow cheatsheet](https://danielkummer.github.io/git-flow-cheatsheet/).

## Code style

We adhere Google code style guides:
* JavaScript:https://google.github.io/styleguide/jsguide.html
* JSON: https://google.github.io/styleguide/jsoncstyleguide.xml
* TypeSript: https://github.com/google/ts-style

Сoding conventions for writing solidity code:
* Solidity: http://solidity.readthedocs.io/en/develop/style-guide.html

## Commit message
> Describe your changes in imperative mood, e.g. "make xyzzy do frotz" instead of "[This patch] makes xyzzy do frotz" or "[I] changed xyzzy to do frotz", as if you are giving orders to the codebase to change its behavior.

As is described at [Documentation/SubmittingPatches in the Git repo](https://git.kernel.org/pub/scm/git/git.git/tree/Documentation/SubmittingPatches?id=HEAD#n133)

## Tests

For any new programmatic functionality, we like unit tests when possible, so if you can keep your code cleanly isolated, please do add a test file to the tests folder.

## Pull Request Process

1. Don't forget to actualize a documentation and dependencies.
1. Increase the version numbers if it needed. The versioning scheme we use is [SemVer](http://semver.org/).
1. If this PR closes the issue, add the line `Fixes #$ISSUE_NUMBER`. Ex. For closing issue 42, include the line `Fixes #42`.
1. If it doesn't close the issue but addresses it partially, just include a reference to the issue number, like `#42`.

For more information about keywords take a look at [Closing issues using keywords](https://help.github.com/articles/closing-issues-using-keywords/)

# Public place to talk

* [Telegram EN](https://t.me/privatix)
* [Telegram RU](https://t.me/privatix_ru)
* [Telegram CH](https://t.me/privatix_cn)