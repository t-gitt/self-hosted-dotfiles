const width = 0.8;
const duration = 1.5;
const begin = 50;
const num = 10;
//const end = 150;
const end = begin + num;
const speed = 60/duration;
//const speed = 60;


let canvas = document.getElementById("canvas");
let ctx = canvas.getContext("2d");
canvas.style.height = `${window.innerHeight}px`;
canvas.style.width = `${window.innerWidth}px`;
canvas.height = window.innerHeight*2;
canvas.width = window.innerWidth*2;

// 3.7441832682291665 3.7441837565104166
//xminArray = [3.1, 3.6619111, 3.6, 3.8]
//xmaxArray = [4, 3.6799119, 3.8, 4]
//3.5730674987157185, 3.573069175660875
xminArray = [3.8483111, 3.1, 3.61211]
xmaxArray = [3.8983999, 4, 3.69299]
let randomIndex = Math.floor(Math.random() * xminArray.length)
let randomxMin = xminArray[randomIndex];
let randomxMax = xmaxArray[randomIndex];
let setup = {
  xMin:randomxMin,
  xMax:randomxMax,
  yMin:0,
  yMax:1
}

let main_color;
function update_color(newColorScheme){
    if (newColorScheme === "dark") {
      main_color ="rgba(245,245,245,0.7)";
    }else{
      main_color = "rgba(0,0,0,0.7)";
    }
  update(setup)
  }
if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
  update_color("dark");
} else{
  update_color("light");
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
  const newColorScheme = e.matches ? "dark" : "light";
  update_color(newColorScheme);
});
function* general_function(r,x){
  for(let i = 0; i < end; i++){
    x = r*x*(1-x);
    yield x;
  }
}
function scale([a,b,c,d,x]){
  return c + (x-a)/(b-a) * (d-c);
}

// const speed = 60;

let transp = 0.25;
let colors = ['rgba(255,0,0, '+transp+ ')', 'rgba(0,255,0,' +transp+ ')', 'rgba(0,0,255,'+ transp +')'];
function get_random_rgba(){
let randomIndex = Math.floor(Math.random() * colors.length);
return colors[randomIndex];
}

function save_json(dictionary){
  var fileContent = JSON.stringify(dictionary);;
  var bb = new Blob([fileContent ], { type: 'text/plain' });
  var a = document.createElement('a');
  a.download = 'download.txt';
  a.href = window.URL.createObjectURL(bb);
  a.click();
}

let dictionary = {}
function draw(r,configs,recursive){

  let { yMin, yMax, xMin, xMax, step } = configs;
  return function(){
    for(let e = 0; e < speed; e++, r+=step){
      let t = general_function(r,0.5);
      //for(let i = 0; i < begin; i++) t.next();
      ctx.beginPath();
      for(let i of [...t]){
        let [x,y] = [[xMin,xMax,0,canvas.width,r],
                    [yMin,yMax,canvas.height,0,i]].map(scale);
        
        dictionary[i] = [x,y];
        ctx.rect(x-width/2, y-width/2, width, width);
      }
              ctx.fillStyle = main_color;
              ctx.fill();
    }
    if(r < xMax) {requestAnimationFrame(draw(r,configs,recursive))}
            else if(recursive){
              recursive(configs);
            }
  }
}

function update(configs,recursive){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  setup.step = scale([0,canvas.width,0,setup.xMax-setup.xMin,0.5]);
  requestAnimationFrame(draw(configs.xMin,configs,recursive));
}

function init(){
	update(setup)
}

window.onload = init;
