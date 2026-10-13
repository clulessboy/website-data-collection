# Bloodborne Pathogens 2021 course runner

Drives the Washington L&I [Bloodborne Pathogens 2021](https://wisha-training.lni.wa.gov/Training/articulate/BBPathogens/story.html)
Articulate Storyline 360 course in headless Chromium (Playwright):

1. Clicks **Start Course** and steps through every slide with the Next button,
   saving a screenshot and the slide text (read from Storyline's accessibility layer).
2. Before the quiz, visits any menu slides the linear path skips (the
   "What would you do?" scenario branches).
3. Answers the 5-question quiz (80% to pass) and records the course's feedback.
4. On the results slide, clicks **Print results**, types the given name, and
   saves the results page Storyline opens as `certificate.pdf` / `.png` / `.txt`.

## Run

```sh
npm install
node run.js output "Your Name"          # full course, ~10 minutes
node run.js output "Your Name" 5000 quiz # jump straight to the quiz (testing)
```

Arguments: `<outDir> [name] [dwellMs per slide, default 8000] [quiz]`.
Without a name it stops on the results slide instead of printing.

The course has no LMS/SCORM backend (`lmsPresent: false`), so nothing is
reported to L&I; the printed results page is the only record of completion.

## Course structure

- 58 content slides (opening, body) — see `html5/data/js/data.js` in the course.
- Quiz: 5 multiple-choice questions, pass mark 80%.
- `storyline-to-json.js` converts a Storyline `globalProvideData(...)` data file
  (e.g. `html5/data/js/data.js` or a slide's `html5/data/js/<id>.js`) to JSON.
