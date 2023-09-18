#include <stdio.h>
#include "schema.h"

int main(){
    struct test_t test;
    test.field4 = 65;
    test.field3 = 1024;
    FILE* out = fopen("schema.bin", "w");
    fwrite(&test, sizeof(test), 1, out);
    fclose(out);
}