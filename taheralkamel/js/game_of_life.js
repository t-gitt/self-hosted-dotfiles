            let w;
            let columns;            
let rows;
            let board;
            let newgen;

            function windowResized() {
            resizeCanvas(windowWidth, windowHeight);
            }
            function setup() {
            var cnvs  = createCanvas(windowWidth, windowHeight);
            cnvs.parent("body");
            cnvs.style('display', 'block');
            cnvs.style('z-index', '-1');
            cnvs.position(0,0);
            w = 20;
            columns = floor(width / w);
            rows = floor(height / w);
            board = new Array(columns);
            for (let i = 0; i < columns; i++) {
                board[i] = new Array(rows);
            }
            newgen = new Array(columns);
            for (i = 0; i < columns; i++) {
                newgen[i] = new Array(rows);
            }
            init();
            }

            function draw() {
            background('black');
            generate();
            for ( let i = 0; i < columns;i++) {
                for ( let j = 0; j < rows;j++) {
                if ((board[i][j] == 1)){ 
                    stroke('#292929');
                    strokeWeight(5)
                    point(i * w, j * w);
                } else{ 
                    fill(0);
                }
                }
            }

            }

            //function mousePressed() {
            //init();
            //}

            function init() {
            for (let i = 0; i < columns; i++) {
                for (let j = 0; j < rows; j++) {
                if (i == 0 || j == 0 || i == columns-1 || j == rows-1) board[i][j] = 0;
                else board[i][j] =  floor(random(2));
                newgen[i][j] = 0;
                }
            }
            }

            function generate() {

            for (let x = 1; x < columns - 1; x++) {
                for (let y = 1; y < rows - 1; y++) {
                let neighbors = 0;
                for (let i = -1; i <= 1; i++) {
                    for (let j = -1; j <= 1; j++) {
                    neighbors += board[x+i][y+j];
                    }
                }

                neighbors -= board[x][y];
                if      ((board[x][y] == 1) && (neighbors <  2)) newgen[x][y] = 0;
                else if ((board[x][y] == 1) && (neighbors >  3)) newgen[x][y] = 0;
                else if ((board[x][y] == 0) && (neighbors == 3)) newgen[x][y] = 1;
                else                                             newgen[x][y] = board[x][y];
                }
            }

            let temp = board;
            board = newgen;
            newgen = temp;
            }
