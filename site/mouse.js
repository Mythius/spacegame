var MOUSE = { pos: { x: 0, y: 0 }, down: false };

function events() {
    function mousemove(e) {
        let cr = canvas.getBoundingClientRect();
        MOUSE.pos.x = e.clientX - cr.left;
        MOUSE.pos.y = e.clientY - cr.top;
    }

    function mouseup(e) {
        MOUSE.down = false;
    }

    function mousedown(e) {
        MOUSE.down = true;
        mousemove(e);
    }
    document.addEventListener('mousemove', mousemove);
    document.addEventListener('mouseup', mouseup);
    document.addEventListener('mousedown', mousedown);
}

events();